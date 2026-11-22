#!/usr/bin/env python3
"""Exact reviewed PWA artifact validation. No build, tag, Docker load or server operation."""
import argparse
import datetime as dt
import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
APPROVAL_SHA256 = 'c8a644cac461716952ca1776220d69cb80b041d8efe1ae6d8d545eb3872da494'
API = 'https://api.github.com/repos/afedotov89/wipster/'
MAX_ZIP = 128 * 1024 * 1024
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_EXPANSION = 1536 * 1024 * 1024


class Invalid(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise Invalid(reason)


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def decode(raw):
    require(len(raw) <= 2 * 1024 * 1024, 'JSON size')
    return json.loads(raw, object_pairs_hook=unique_pairs)


def validate_delivery_identity(pin, proofs):
    delivery = proofs['proofs/delivery-ops.json']
    baseline = proofs['proofs/installed-ops.json']
    require((pin['required_installed_ops_sha256'], pin['required_installed_ops_source']) ==
            (delivery['ops_sha256'], delivery['source']), 'required installed ops identity')
    require(delivery['base_source'] == baseline['source']
            and delivery['base_ops_sha256'] == baseline['ops_sha256'], 'delivery baseline')
    require(delivery['ops_sha256'] != pin['image_ops_sha256']
            and delivery['ops_sha256'] != baseline['ops_sha256'], 'image and delivery ops separation')
    require(re.fullmatch('[0-9a-f]{40}', delivery['source'])
            and delivery['source'] == delivery['compatibility']['source']
            and delivery['source'] not in (pin['source'], baseline['source']), 'runtime source separation')


def validate_compatibility_metadata(run, jobs, artifact, pin, proofs):
    expected = proofs['proofs/compatibility-ci.json']
    compat = proofs['proofs/delivery-ops.json']['compatibility']
    require((run['id'], run['run_attempt'], run['head_sha'], run['event'], run['status'], run['conclusion']) ==
            (compat['run'], compat['attempt'], compat['source'], 'push', 'completed', 'success')
            and compat['run'] == pin['compatibility_run'], 'compatibility run')
    require(run['path'] == '.github/workflows/pwa_promotion_ci.yml'
            and run['head_branch'] == 'pwa/promotion-verify-20261120', 'compatibility workflow')
    for name in ['repository', 'head_repository']:
        require(run[name]['id'] == pin['repository_id']
                and run[name]['full_name'] == pin['repository'], 'compatibility repository')
    require(jobs['total_count'] == len(jobs['jobs']) == 2, 'compatibility jobs')
    actual = {j['id']: j for j in jobs['jobs']}
    original = {j['id']: j for j in expected['jobs']['jobs']}
    require(set(actual) == set(original) and len(actual) == 2, 'compatibility job identities')
    for key, j in actual.items():
        require(j['run_id'] == compat['run'] and j['head_sha'] == compat['source']
                and j['run_attempt'] == compat['attempt'] and j['status'] == 'completed'
                and j['conclusion'] == 'success', 'compatibility job result')
        require(all(j[k] == original[key][k] for k in ['name', 'started_at', 'completed_at', 'steps']),
                'compatibility original job provenance')
        require(j['steps'] and all(s['status'] == 'completed' and s['conclusion'] in ('success', 'skipped')
                                  for s in j['steps']), 'compatibility step failure')
    require({j['name'] for j in actual.values()} == {'compatibility', 'validator'}, 'compatibility gate')
    for key in ['id', 'name', 'size_in_bytes', 'digest', 'workflow_run']:
        require(artifact[key] == expected['artifact'][key], 'compatibility artifact provenance')
    require(artifact['id'] == compat['artifact_id'] and artifact['digest'] == 'sha256:' + compat['artifact_sha256']
            and not artifact['expired'], 'compatibility artifact')


def validate_delivery_ops(pin, proofs, directory=HERE):
    validate_delivery_identity(pin, proofs)
    delivery = proofs['proofs/delivery-ops.json']
    require(delivery['path'] == 'deploy/pwa_promotion/runtime_ops', 'runtime bundle path')
    root = directory / 'runtime_ops'
    paths = [p for p in root.rglob('*') if '__pycache__' not in p.parts]
    require(not root.is_symlink() and not any(p.is_symlink() for p in paths), 'runtime bundle symlink')
    files = {p.relative_to(root).as_posix(): digest(p) for p in paths if p.is_file()}
    require(files == delivery['files'], 'runtime bundle file identity')
    fingerprint = hashlib.sha256()
    for name in sorted(files):
        fingerprint.update(name.encode() + b'\0' + (root / name).read_bytes() + b'\0')
    require(fingerprint.hexdigest() == delivery['ops_sha256'], 'runtime bundle fingerprint')
    baseline = proofs['proofs/installed-ops.json']
    require(set(files) == set(baseline['files']) | {'pwa_migrate.py'}
            and sorted(k for k in files if files[k] != baseline['files'].get(k)) ==
                delivery['changed_from_base'] == ['prepare.sh', 'pwa_migrate.py', 'release.sh'], 'minimal runtime diff')
    require(delivery['maintenance_units'] == baseline['maintenance_units'], 'maintenance baseline')
    for name, info in delivery['maintenance_units'].items():
        require(files['systemd/' + name] == info['sha256'] and
                (root / 'systemd' / name).read_text().splitlines().count(
                    'Environment=DOCKER_CONFIG=/srv/wipster/config/docker-cli') == 1, 'maintenance bytes')
    compat = delivery['compatibility']
    require(files['pwa_migrate.py'] == compat['helper_sha256'], 'verified helper identity')
    for name, expected in compat['harness_files'].items():
        require(name in ['compatibility/run.py', 'compatibility/fixture.py'] and digest(directory / name) == expected,
                'verified compatibility harness')
    receipt = proofs['proofs/compatibility.json']
    require(receipt['helper_sha256'] == compat['helper_sha256'] and receipt['new_source'] == pin['source']
            and receipt['old_source'] == pin['live_preflight']['expected_current']['record']['source']
            and receipt['postgres_major'] == 18 and receipt['synthetic_only'] and receipt['no_live_access']
            and len(receipt['cases']) == receipt['expected_cases'] == 9
            and all(c['result'] == 'PASS' for c in receipt['cases']) and receipt['cleanup_databases'] == 8,
            'real compatibility proof')
    ci = proofs['proofs/compatibility-ci.json']
    validate_compatibility_metadata(ci['run'], ci['jobs'], ci['artifact'], pin, proofs)


def delivery_outputs(pin, proofs):
    validate_delivery_identity(pin, proofs)
    return {'source': pin['source'], 'config': pin['image'], 'archive': pin['archive_sha256'],
            'ops': pin['required_installed_ops_sha256'], 'ops_source': pin['required_installed_ops_source']}


def load_approval(directory=HERE, repository=ROOT):
    raw = (directory / 'approved_pwa_artifact.json').read_bytes()
    require(hashlib.sha256(raw).hexdigest() == APPROVAL_SHA256, 'approval bytes changed')
    pin = decode(raw)
    require(pin['schema'] == 1 and pin['repository_id'] == 1138317534
            and pin['repository'] == 'afedotov89/wipster', 'approval repository')
    proofs = {}
    for name, expected in pin['proofs'].items():
        require(PurePosixPath(name).parts[0] == 'proofs' and '..' not in PurePosixPath(name).parts, 'proof path')
        data = (directory / name).read_bytes()
        require(hashlib.sha256(data).hexdigest() == expected, 'proof bytes changed')
        proofs[name] = decode(data)
    dep = pin['validator_dependency']
    require(dep['path'] == 'deploy/msf/verify_archive.py'
            and digest(repository / dep['path']) == dep['sha256'], 'historical verifier bytes changed')
    static = proofs['proofs/static.json']
    require((static['source'], static['run'], static['attempt']) ==
            (pin['source'], str(pin['build_run']), str(pin['artifact_build_attempt'])), 'static source provenance')
    require(pin['proofs']['proofs/static.json'] == pin['static_manifest_sha256'], 'static manifest identity')
    require(len(static['files']) == pin['static_file_count'], 'static inventory')
    runtime = proofs['proofs/runtime.json']
    require(runtime['source'] == pin['source'] and runtime['image'] == pin['image']
            and len(runtime['files']) == pin['runtime_file_count'], 'runtime source identity')
    context = proofs['proofs/context.json']
    require(len(context['files']) == pin['context_file_count'], 'context inventory')
    require(hashlib.sha256(canonical({'files': context['files']})).hexdigest()
            == context['fingerprint_sha256'], 'context file manifest')
    ops = proofs['proofs/installed-ops.json']
    require(ops['source'] == pin['observed_installed_ops']['source']
            and ops['ops_sha256'] == pin['observed_installed_ops']['sha256'], 'observed baseline ops identity')
    validate_delivery_ops(pin, proofs, directory)
    root_plan = proofs['proofs/root-plan.json']
    for name, expected in root_plan['snapshot_files'].items():
        require(name in ['before.conf', 'proposed.conf', 'proposal.conf']
                and digest(directory / 'root' / name) == expected, 'root snapshot identity')
    require(root_plan['original_vhost_sha256'] == pin['live_preflight']['vhost_sha256']
            and root_plan['snapshot_files']['before.conf'] == root_plan['original_vhost_sha256']
            and root_plan['snapshot_files']['proposed.conf'] == root_plan['proposed_vhost_sha256']
            and root_plan['snapshot_files']['proposal.conf'] == root_plan['proposal_sha256']
            and not root_plan['applied'], 'root plan observation')
    transport = pin['ssh_transport']
    require(transport['known_hosts_file'] == 'msf_known_hosts' and digest(directory / 'msf_known_hosts') == transport['known_hosts_sha256'], 'SSH host-key pin')
    return pin, proofs


def validate_jobs(data, expected, attempt, pin):
    require(data['total_count'] == len(data['jobs']) == len(expected), 'CI job inventory')
    found = {j['id']: j for j in data['jobs']}
    require(len(found) == len(expected) and set(found) == {j['id'] for j in expected}, 'CI job identities')
    for item in expected:
        job = found[item['id']]
        require(job['run_id'] == pin['build_run'] and job['head_sha'] == pin['source']
                and job['run_attempt'] == attempt, 'CI source/run/attempt')
        require(job['status'] == 'completed', 'CI job incomplete')
        for key in ['name', 'run_attempt', 'started_at', 'completed_at', 'conclusion']:
            require(job[key] == item[key], 'CI job provenance ' + key)
        require(hashlib.sha256(canonical(job['steps'])).hexdigest() == item['steps_sha256'], 'CI steps changed')
        if item['conclusion'] == 'success':
            require(job['steps'] and all(s['status'] == 'completed' and s['conclusion'] in
                                        ('success', 'skipped') for s in job['steps']), 'CI step failure')
    return {j['name']: j for j in data['jobs']}


def validate_metadata(run, jobs, origin_jobs, artifact, pin, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    require((run['id'], run['run_attempt'], run['workflow_id'], run['path']) ==
            (pin['build_run'], pin['successful_run_attempt'], pin['workflow_id'], pin['workflow_path']), 'build identity')
    require((run['event'], run['head_branch'], run['head_sha'], run['status'], run['conclusion']) ==
            ('workflow_dispatch', pin['source_branch'], pin['source'], 'completed', 'success'), 'build result/source')
    for key in ['repository', 'head_repository']:
        require(run[key]['id'] == pin['repository_id'] and run[key]['full_name'] == pin['repository'], 'build repository')
    current = validate_jobs(jobs, pin['current_jobs'], pin['successful_run_attempt'], pin)
    origin = validate_jobs(origin_jobs, pin['origin_jobs'], pin['artifact_build_attempt'], pin)
    for name in pin['inherited_names']:
        require(current[name]['conclusion'] == origin[name]['conclusion'] == 'success'
                and all(current[name][k] == origin[name][k] for k in ['steps', 'started_at', 'completed_at']),
                'inherited attempt1 job provenance')
    require(current['cloud-regressions / native-and-frontend']['conclusion'] == 'success'
            and current['deploy']['conclusion'] == 'skipped' and not current['deploy']['steps'], 'native/deploy gate')
    require((artifact['id'], artifact['name'], artifact['size_in_bytes'], artifact['digest']) ==
            (pin['artifact_id'], pin['artifact_name'], pin['zip_bytes'], 'sha256:' + pin['zip_sha256']), 'artifact identity')
    require(not artifact['expired'] and 0 < artifact['size_in_bytes'] <= MAX_ZIP, 'artifact expired/size')
    require(dt.datetime.fromisoformat(artifact['expires_at'].replace('Z', '+00:00')) > now, 'artifact expiry')
    owner = artifact['workflow_run']
    require((owner['id'], owner['head_sha'], owner['head_branch'], owner['repository_id'], owner['head_repository_id']) ==
            (pin['build_run'], pin['source'], pin['source_branch'], pin['repository_id'], pin['repository_id']), 'artifact owner')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def safe_blob(url):
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname or ''
    require(parsed.scheme == 'https' and parsed.port in (None, 443) and not parsed.username
            and not parsed.password and not parsed.fragment, 'blob URL shape')
    require(host.endswith('.blob.core.windows.net') or host.endswith('.actions.githubusercontent.com')
            or host == 'objects.githubusercontent.com', 'blob host')
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return url
    raise Invalid('blob IP host')


class BlobRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return urllib.request.Request(safe_blob(urllib.parse.urljoin(req.full_url, newurl)),
                                      headers={'Accept-Encoding': 'identity'})


def api(path, token, artifact_redirect=False):
    require(not path.startswith('/') and '..' not in path and '://' not in path, 'API path')
    request = urllib.request.Request(API + path, headers={'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
            return decode(response.read(2 * 1024 * 1024 + 1))
    except urllib.error.HTTPError as error:
        if artifact_redirect and error.code in (301, 302, 303, 307, 308):
            return safe_blob(error.headers['Location'])
        raise Invalid('GitHub request failed (response withheld)') from None


def download(destination, pin, token):
    location = api('actions/artifacts/' + str(pin['artifact_id']) + '/zip', token, True)
    deadline = time.monotonic() + 180
    size = 0
    try:
        # Deliberately new opener/Request, with no bearer/cookies/forwarded API headers.
        request = urllib.request.Request(location, headers={'Accept-Encoding': 'identity'})
        with urllib.request.build_opener(BlobRedirect).open(request, timeout=20) as response, destination.open('xb') as out:
            safe_blob(response.url)
            require(response.headers.get('Content-Encoding', 'identity') == 'identity', 'blob encoding')
            while True:
                require(time.monotonic() < deadline, 'download deadline')
                block = response.read(min(1024 * 1024, pin['zip_bytes'] - size + 1))
                if not block:
                    break
                size += len(block)
                require(size <= pin['zip_bytes'] <= MAX_ZIP, 'download size')
                out.write(block)
        require(size == pin['zip_bytes'], 'download truncated')
    except Exception:
        destination.unlink(missing_ok=True)
        raise Invalid('bounded artifact download failed (URL withheld)') from None


def unpack_zip(path, target, pin):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size == pin['zip_bytes']
            <= MAX_ZIP and digest(path) == pin['zip_sha256'], 'raw ZIP identity')
    expected = {'backend-image.json': 65536, 'pwa-provenance.json': 65536,
                'backend-image.tar.gz': MAX_ARCHIVE}
    require(not target.exists(), 'output already exists')
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        require(len(entries) == 3 and {e.filename for e in entries} == set(expected), 'exact THREE entry schema')
        for e in entries:
            require(not e.is_dir() and not e.flag_bits & 1 and (e.external_attr >> 16) & 0o170000 in
                    (0, 0o100000), 'non-regular/encrypted ZIP member')
            require(0 < e.file_size <= expected[e.filename] and e.compress_size > 0
                    and e.file_size <= max(1024 * 1024, e.compress_size * 200), 'ZIP expansion bound')
        target.mkdir(mode=0o700)
        try:
            for e in entries:
                count = 0
                with archive.open(e) as incoming, (target / e.filename).open('xb') as out:
                    for block in iter(lambda: incoming.read(1024 * 1024), b''):
                        count += len(block)
                        require(count <= e.file_size <= expected[e.filename], 'ZIP actual expansion')
                        out.write(block)
                require(count == e.file_size, 'ZIP truncated')
        except Exception:
            shutil.rmtree(target)
            raise


def validate_provenance(metadata, provenance, pin):
    require(metadata == {'source': pin['source'], 'image': pin['image'],
            'archive_sha256': pin['archive_sha256'], 'ops_sha256': pin['image_ops_sha256']}, 'inner image metadata')
    require(provenance == {'source': pin['source'], 'run': str(pin['build_run']),
            'attempt': str(pin['artifact_build_attempt']), 'image': pin['image'],
            'context_sha256': pin['context_sha256'],
            'static_manifest_sha256': pin['static_manifest_sha256']}, 'PWA provenance')


def verify_image(path, pin, proofs, repository=ROOT):
    require(digest(path) == pin['archive_sha256'], 'inner archive digest')
    verified = subprocess.run([sys.executable, str(repository / pin['validator_dependency']['path']), str(path),
        pin['source'], pin['image'], '--json'], capture_output=True, text=True, timeout=90)
    require(verified.returncode == 0, 'historical immutable archive guard')
    identity = decode(verified.stdout.encode())
    require(identity['manifest'] == pin['oci_manifest'], 'OCI manifest')
    app = {}
    expanded = 0
    entries = 0
    deadline = time.monotonic() + 120
    with tarfile.open(path, 'r:gz') as archive:
        manifest = decode(archive.extractfile('manifest.json').read())[0]
        config = decode(archive.extractfile(manifest['Config']).read())
        require(config['config']['User'] == 'app', 'runtime user')
        labels = config['config'].get('Labels', {})
        require(labels.get('org.opencontainers.image.revision') == pin['source']
                and labels.get('io.wipster.context.sha256') == pin['context_sha256'], 'runtime source/context')
        require(not any(e.split('=', 1)[0] in {'DATABASE_URL', 'SECRET_KEY', 'YANDEX_CLIENT_SECRET',
                    'POSTGRES_PASSWORD'} for e in config['config'].get('Env', [])), 'runtime credential environment')
        for layer in manifest['Layers']:
            with archive.extractfile(layer) as stream, tarfile.open(fileobj=stream, mode='r|*') as content:
                for entry in content:
                    entries += 1
                    require(entries <= 100000 and time.monotonic() < deadline, 'runtime entries/deadline')
                    name = entry.name
                    p = PurePosixPath(name)
                    require(not p.is_absolute() and '..' not in p.parts, 'layer traversal')
                    name = p.as_posix().removeprefix('./')
                    expanded += entry.size
                    require(expanded <= MAX_EXPANSION, 'runtime expansion bound')
                    require(not any(x in p.parts for x in ['node_modules', '.git', '.env', 'tests_cloud'])
                            and name not in ['usr/local/bin/node', 'usr/local/bin/npm', 'usr/local/bin/npx'],
                            'unexpected runtime tool/fixture')
                    if name.startswith('app/'):
                        require('/.wh.' not in name and (entry.isfile() or entry.isdir()), 'app link/whiteout')
                        if entry.isfile():
                            require(entry.size <= 16 * 1024 * 1024, 'app file bound')
                            with content.extractfile(entry) as source:
                                app[name] = hashlib.file_digest(source, 'sha256').hexdigest()
    require(app == proofs['proofs/runtime.json']['files'], 'runtime/source file mismatch')
    require({name.removeprefix('app/pwa/'): sha for name, sha in app.items() if name.startswith('app/pwa/')} ==
            proofs['proofs/static.json']['files'], 'runtime/static mismatch')
    return identity


def verify_package(path, target, pin, proofs, repository=ROOT):
    unpack_zip(path, target, pin)
    validate_provenance(decode((target / 'backend-image.json').read_bytes()),
                        decode((target / 'pwa-provenance.json').read_bytes()), pin)
    return verify_image(target / 'backend-image.tar.gz', pin, proofs, repository)


def promotion_context(env, head, pin):
    for key in ['GITHUB_SHA', 'GITHUB_WORKFLOW_SHA', 'EXPECTED_PROMOTION_SOURCE']:
        require(re.fullmatch('[0-9a-f]{40}', env.get(key, '')) and env[key] == head, 'promotion source')
    require(head not in (pin['source'], pin['required_installed_ops_source'],
                        pin['observed_installed_ops']['source']), 'distinct promotion code source')
    require(env.get('GITHUB_REPOSITORY') == pin['repository']
            and env.get('GITHUB_REPOSITORY_ID') == str(pin['repository_id']), 'promotion repository')
    require(env.get('GITHUB_REF') == 'refs/heads/main'
            and env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
            and env.get('DEPLOY_ENABLED') == 'true'
            and env.get('DEPLOY_ENVIRONMENT') == 'wipster-production', 'promotion main/environment/flag')
    require(re.fullmatch('[1-9][0-9]{0,19}', env.get('GITHUB_RUN_ID', '')) and
            int(env['GITHUB_RUN_ID']) not in (pin['build_run'], pin['compatibility_run']), 'promotion run')
    require(re.fullmatch('[1-9][0-9]{0,19}', env.get('GITHUB_RUN_ATTEMPT', '')), 'promotion attempt')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['verify-only', 'fetch'])
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    pin, proofs = load_approval()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, timeout=10).strip()
    if args.mode == 'fetch':
        promotion_context(os.environ, head, pin)
    token = os.environ['GH_TOKEN']
    run = api('actions/runs/' + str(pin['build_run']), token)
    jobs = api(f"actions/runs/{pin['build_run']}/attempts/{pin['successful_run_attempt']}/jobs?per_page=100", token)
    origin = api(f"actions/runs/{pin['build_run']}/attempts/{pin['artifact_build_attempt']}/jobs?per_page=100", token)
    artifact = api('actions/artifacts/' + str(pin['artifact_id']), token)
    validate_metadata(run, jobs, origin, artifact, pin)
    compat = proofs['proofs/delivery-ops.json']['compatibility']
    validate_compatibility_metadata(api(f"actions/runs/{compat['run']}/attempts/{compat['attempt']}", token),
        api(f"actions/runs/{compat['run']}/attempts/{compat['attempt']}/jobs?per_page=100", token),
        api(f"actions/artifacts/{compat['artifact_id']}", token), pin, proofs)
    raw = args.output.with_suffix('.zip')
    try:
        download(raw, pin, token)
        identity = verify_package(raw, args.output, pin, proofs)
    finally:
        raw.unlink(missing_ok=True)
    receipt = {'schema': 1, 'validation_only': args.mode == 'verify-only',
        'image_source': pin['source'], 'image_build_run': pin['build_run'],
        'image_build_attempt': pin['artifact_build_attempt'], 'successful_run_attempt': pin['successful_run_attempt'],
        'artifact_id': pin['artifact_id'], 'approval_sha256': APPROVAL_SHA256,
        'original_package': {k: pin[k] for k in ['zip_sha256', 'archive_sha256', 'image', 'oci_manifest',
            'image_ops_sha256', 'context_sha256', 'static_manifest_sha256']},
        'observed_installed_ops': pin['observed_installed_ops'],
        'required_installed_ops_sha256': pin['required_installed_ops_sha256'],
        'required_installed_ops_source': pin['required_installed_ops_source'],
        'compatibility_proof': proofs['proofs/delivery-ops.json']['compatibility'],
        'promotion_source': head,
        'promotion_run': os.environ.get('GITHUB_RUN_ID') if args.mode == 'fetch' else None,
        'promotion_attempt': os.environ.get('GITHUB_RUN_ATTEMPT') if args.mode == 'fetch' else None,
        'verification_run': os.environ.get('GITHUB_RUN_ID') if args.mode == 'verify-only' else None,
        'verification_attempt': os.environ.get('GITHUB_RUN_ATTEMPT') if args.mode == 'verify-only' else None,
        'validated_archive_identity': identity,
        'live_preflight_is_observation_not_reservation': True}
    (args.output / 'pwa-promotion-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    if args.mode == 'fetch':
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            for key, value in delivery_outputs(pin, proofs).items():
                output.write(f'{key}={value}\n')
    print('Exact PWA artifact, complete same-source CI, inherited provenance and immutable image verified')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('PWA artifact validation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
