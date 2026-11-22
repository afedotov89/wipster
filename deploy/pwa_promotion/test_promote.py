import copy
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

import promote as p

NOW = dt.datetime(2026, 11, 20, tzinfo=dt.timezone.utc)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def tar(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        for name, value in entries:
            item = tarfile.TarInfo(name)
            if isinstance(value, tarfile.TarInfo):
                archive.addfile(value)
            else:
                item.size = len(value)
                archive.addfile(item, io.BytesIO(value))
    return stream.getvalue()


def image_fixture(folder, original, mode='valid'):
    pin = copy.deepcopy(original)
    files = {'app/manage.py': b'pass\n', 'app/pwa/index.html': b'PWA\n'}
    entries = list(files.items())
    if mode == 'extra-runtime':
        entries.append(('app/extra', b'wrong'))
    if mode == 'traversal':
        entries.append(('../escape', b'wrong'))
    if mode == 'app-symlink':
        link = tarfile.TarInfo('app/link'); link.type = tarfile.SYMTYPE; link.linkname = '/etc/passwd'
        entries.append((link.name, link))
    if mode == 'expansion-bomb':
        item = tarfile.TarInfo('app/bomb'); item.size = p.MAX_EXPANSION + 1
        layer = item.tobuf() + b'\0' * 1024
    else:
        layer = tar(entries)
    config = {'os': 'linux', 'architecture': 'amd64', 'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + sha(layer)]},
              'config': {'User': 'root' if mode == 'root-user' else 'app', 'Env': [],
                         'Labels': {'org.opencontainers.image.revision': pin['source'],
                                    'io.wipster.context.sha256': '0' * 64 if mode == 'context' else pin['context_sha256']}}}
    config_raw = p.canonical(config); config_sha = sha(config_raw)
    oci = {'schemaVersion': 2, 'config': {'mediaType': 'application/vnd.oci.image.config.v1+json',
            'digest': 'sha256:' + config_sha, 'size': len(config_raw)}, 'layers': [
            {'mediaType': 'application/vnd.oci.image.layer.v1.tar', 'digest': 'sha256:' + sha(layer), 'size': len(layer)}]}
    oci_raw = p.canonical(oci)
    index = {'schemaVersion': 2, 'manifests': [{'mediaType': 'application/vnd.oci.image.manifest.v1+json',
             'digest': 'sha256:' + sha(oci_raw), 'size': len(oci_raw)}]}
    legacy = [{'Config': 'blobs/sha256/' + config_sha, 'RepoTags': ['wipster-backend:' + pin['source']],
               'Layers': ['blobs/sha256/' + sha(layer)]}]
    layers = [('manifest.json', p.canonical(legacy)), ('oci-layout', b'{"imageLayoutVersion":"1.0.0"}'),
              ('index.json', p.canonical(index)), ('blobs/sha256/' + config_sha, config_raw),
              ('blobs/sha256/' + sha(oci_raw), oci_raw),
              ('blobs/sha256/' + sha(layer), layer + (b'corrupt' if mode == 'layer-corruption' else b''))]
    if mode == 'duplicate-tar':
        layers.append(('manifest.json', p.canonical(legacy)))
    archive = folder / 'image.tar.gz'
    with tarfile.open(archive, 'w:gz') as output:
        for name, data in layers:
            item = tarfile.TarInfo(name); item.size = len(data); output.addfile(item, io.BytesIO(data))
    pin.update(image='sha256:' + config_sha, oci_manifest='sha256:' + sha(oci_raw), archive_sha256=p.digest(archive))
    proofs = {'proofs/runtime.json': {'files': {name: sha(raw) for name, raw in files.items()}},
              'proofs/static.json': {'files': {'index.html': sha(files['app/pwa/index.html'])}}}
    return archive, pin, proofs


class Metadata(unittest.TestCase):
    def setUp(self):
        self.pin, self.proofs = p.load_approval()
        self.fixture = json.loads((p.HERE / 'proofs/ci-fixture.json').read_text())

    def validate(self, data=None):
        f = data or self.fixture
        p.validate_metadata(f['run'], f['jobs'], f['origin_jobs'], f['artifact'], self.pin, NOW)

    def test_actual_reviewed_metadata_and_proof_pins(self):
        self.validate()
        self.assertEqual(self.pin['artifact_build_attempt'], 1)
        self.assertEqual(self.pin['successful_run_attempt'], 2)
        self.assertEqual(self.pin['observed_installed_ops']['source'], 'c0e286df90c4dad6e766ea28ec46fa8fd94f0a96')
        self.assertEqual(self.pin['required_installed_ops_source'], 'e07183d440c970b62136469706ba0afa571a1138')
        self.assertNotEqual(self.pin['required_installed_ops_sha256'], self.pin['image_ops_sha256'])

    def test_wrong_repository_source_run_attempt_or_gate(self):
        changes = [('run', 'id', 1), ('run', 'run_attempt', 1), ('run', 'head_sha', '0' * 40),
                   ('run', 'workflow_id', 1), ('run', 'path', 'other.yml'), ('run', 'head_branch', 'main'),
                   ('run', 'event', 'push'), ('run', 'conclusion', 'failure'), ('run', 'status', 'in_progress')]
        for section, field, value in changes:
            with self.subTest(field=field):
                f = copy.deepcopy(self.fixture); f[section][field] = value
                with self.assertRaises(p.Invalid): self.validate(f)
        for repo in ['repository', 'head_repository']:
            f = copy.deepcopy(self.fixture); f['run'][repo]['id'] = 7
            with self.assertRaises(p.Invalid): self.validate(f)

    def test_missing_native_duplicate_extra_or_skipped_job(self):
        for mutation in ['native', 'missing', 'duplicate', 'extra']:
            f = copy.deepcopy(self.fixture)
            if mutation == 'native': f['jobs']['jobs'][0]['conclusion'] = 'skipped'
            if mutation == 'missing': f['jobs']['jobs'].pop(0)
            if mutation == 'duplicate': f['jobs']['jobs'][1] = copy.deepcopy(f['jobs']['jobs'][0])
            if mutation == 'extra':
                f['jobs']['jobs'].append(copy.deepcopy(f['jobs']['jobs'][0])); f['jobs']['total_count'] += 1
            with self.subTest(mutation=mutation), self.assertRaises(p.Invalid): self.validate(f)

    def test_inherited_timestamps_steps_or_original_attempt_cannot_be_relabelled(self):
        for section, field, value in [('jobs', 'started_at', '2026-11-20T00:00:00Z'),
                                      ('origin_jobs', 'run_attempt', 2), ('origin_jobs', 'head_sha', '0' * 40)]:
            f = copy.deepcopy(self.fixture); j = next(j for j in f[section]['jobs'] if j['name'] == 'verify-build'); j[field] = value
            with self.subTest(section=section, field=field), self.assertRaises(p.Invalid): self.validate(f)
        f = copy.deepcopy(self.fixture); f['jobs']['jobs'][0]['steps'][7]['conclusion'] = 'skipped'
        with self.assertRaises(p.Invalid): self.validate(f)

    def test_artifact_digest_size_expiry_and_owner(self):
        for field, value in [('id', 1), ('name', 'latest'), ('size_in_bytes', 1),
                             ('digest', 'sha256:' + '0' * 64), ('expired', True), ('expires_at', '2020-01-01T00:00:00Z')]:
            f = copy.deepcopy(self.fixture); f['artifact'][field] = value
            with self.subTest(field=field), self.assertRaises(p.Invalid): self.validate(f)
        for field, value in [('id', 1), ('head_sha', '0' * 40), ('repository_id', 1), ('head_repository_id', 1), ('head_branch', 'main')]:
            f = copy.deepcopy(self.fixture); f['artifact']['workflow_run'][field] = value
            with self.subTest(field=field), self.assertRaises(p.Invalid): self.validate(f)

    def test_promotion_requires_exact_new_main_source_environment_and_flag(self):
        head = 'a' * 40
        env = {'GITHUB_SHA': head, 'GITHUB_WORKFLOW_SHA': head, 'EXPECTED_PROMOTION_SOURCE': head,
               'GITHUB_REPOSITORY': self.pin['repository'], 'GITHUB_REPOSITORY_ID': str(self.pin['repository_id']),
               'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'workflow_dispatch', 'DEPLOY_ENABLED': 'true',
               'DEPLOY_ENVIRONMENT': 'wipster-production', 'GITHUB_RUN_ID': '99999999999', 'GITHUB_RUN_ATTEMPT': '1'}
        p.promotion_context(env, head, self.pin)
        for key, value in [('EXPECTED_PROMOTION_SOURCE', 'b' * 40), ('GITHUB_WORKFLOW_SHA', 'b' * 40),
                           ('GITHUB_REPOSITORY_ID', '7'), ('GITHUB_REF', 'refs/heads/pwa/verify'), ('DEPLOY_ENABLED', 'false'),
                           ('DEPLOY_ENVIRONMENT', 'dev'), ('GITHUB_EVENT_NAME', 'push'), ('GITHUB_RUN_ID', str(self.pin['build_run'])), ('GITHUB_RUN_ID', str(self.pin['compatibility_run']))]:
            with self.subTest(key=key), self.assertRaises(p.Invalid): p.promotion_context(env | {key: value}, head, self.pin)

    def test_approval_or_proof_tamper_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'approved_pwa_artifact.json').write_text('{}')
            with self.assertRaises(p.Invalid): p.load_approval(root)

    def test_duplicate_json_rejected(self):
        with self.assertRaises(p.Invalid): p.decode(b'{"source":"a","source":"b"}')


class Package(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup); self.pin, self.proofs = p.load_approval()

    def zip(self, entries):
        path = self.root / 'package.zip'
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, data in entries:
                archive.writestr(name, data)
        pin = self.pin | {'zip_bytes': path.stat().st_size, 'zip_sha256': p.digest(path)}
        return path, pin

    def test_exact_three_entry_schema_and_raw_digest(self):
        path, pin = self.zip([('backend-image.json', b'{}'), ('pwa-provenance.json', b'{}'), ('backend-image.tar.gz', b'x')])
        p.unpack_zip(path, self.root / 'out', pin)
        with self.assertRaises(p.Invalid): p.unpack_zip(path, self.root / 'out2', pin | {'zip_sha256': '0' * 64})

    def test_extra_duplicate_traversal_or_missing_member(self):
        standard = [('backend-image.json', b'{}'), ('pwa-provenance.json', b'{}'), ('backend-image.tar.gz', b'x')]
        for entries in [standard + [('extra', b'x')], standard[:2] + [standard[0]],
                        standard[:2] + [('../backend-image.tar.gz', b'x')], standard[:2]]:
            path, pin = self.zip(entries)
            with self.subTest(entries=[str(x[0]) for x in entries]), self.assertRaises(p.Invalid): p.unpack_zip(path, self.root / 'out', pin)

    def test_zip_symlink_and_bomb(self):
        link = zipfile.ZipInfo('backend-image.tar.gz'); link.external_attr = (0o120777 << 16)
        for item in [link, 'backend-image.tar.gz']:
            body = b'/etc/passwd' if isinstance(item, zipfile.ZipInfo) else b'\0' * (2 * 1024 * 1024)
            path, pin = self.zip([('backend-image.json', b'{}'), ('pwa-provenance.json', b'{}'), (item, body)])
            with self.assertRaises(p.Invalid): p.unpack_zip(path, self.root / 'out', pin)

    def test_zip_crc_corruption(self):
        path, pin = self.zip([('backend-image.json', b'{"test":1}'), ('pwa-provenance.json', b'{}'), ('backend-image.tar.gz', b'x')])
        raw = bytearray(path.read_bytes())
        with zipfile.ZipFile(path) as archive:
            info = archive.infolist()[0]; offset = info.header_offset + 30 + len(info.filename) + len(info.extra)
        raw[offset] ^= 255; path.write_bytes(raw); pin['zip_sha256'] = p.digest(path)
        with self.assertRaises(Exception): p.unpack_zip(path, self.root / 'out', pin)
        self.assertFalse((self.root / 'out').exists())

    def test_wrong_provenance_ops_context_static_source_or_attempt(self):
        metadata = {'source': self.pin['source'], 'image': self.pin['image'], 'archive_sha256': self.pin['archive_sha256'], 'ops_sha256': self.pin['image_ops_sha256']}
        provenance = {'source': self.pin['source'], 'image': self.pin['image'], 'run': str(self.pin['build_run']), 'attempt': '1', 'context_sha256': self.pin['context_sha256'], 'static_manifest_sha256': self.pin['static_manifest_sha256']}
        p.validate_provenance(metadata, provenance, self.pin)
        for field in metadata:
            with self.subTest(field=field), self.assertRaises(p.Invalid): p.validate_provenance(metadata | {field: 'wrong'}, provenance, self.pin)
        for field in provenance:
            with self.subTest(field=field), self.assertRaises(p.Invalid): p.validate_provenance(metadata, provenance | {field: 'wrong'}, self.pin)

    def test_real_archive_guard_on_small_valid_oci_image(self):
        archive, pin, proofs = image_fixture(self.root, self.pin)
        p.verify_image(archive, pin, proofs)

    def test_oci_layer_runtime_context_links_traversal_and_expansion(self):
        for mode in ['layer-corruption', 'extra-runtime', 'context', 'root-user', 'traversal', 'app-symlink', 'expansion-bomb', 'duplicate-tar']:
            folder = self.root / mode; folder.mkdir()
            archive, pin, proofs = image_fixture(folder, self.pin, mode)
            with self.subTest(mode=mode), self.assertRaises(Exception): p.verify_image(archive, pin, proofs)
        archive, pin, proofs = image_fixture(self.root, self.pin)
        with self.assertRaises(p.Invalid): p.verify_image(archive, pin | {'oci_manifest': 'sha256:' + '0' * 64}, proofs)


class Transport(unittest.TestCase):
    def test_blob_redirects_cannot_target_api_private_host_or_http(self):
        p.safe_blob('https://example.blob.core.windows.net/a?signed=redacted')
        for url in ['http://example.blob.core.windows.net/a', 'https://api.github.com/a', 'https://127.0.0.1/a',
                    'https://example.blob.core.windows.net:444/a', 'https://user:pass@example.blob.core.windows.net/a']:
            with self.subTest(url=url), self.assertRaises(p.Invalid): p.safe_blob(url)
        self.assertIsNone(p.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.blob.core.windows.net/a'))
        redirected = p.BlobRedirect().redirect_request(
            __import__('urllib.request', fromlist=['Request']).Request('https://example.blob.core.windows.net/a', headers={'Authorization': 'Bearer must-not-forward'}),
            None, 302, '', {}, 'https://other.blob.core.windows.net/b')
        self.assertIsNone(redirected.get_header('Authorization'))

    def test_initial_blob_request_has_no_bearer_and_exact_size(self):
        pin, _ = p.load_approval(); pin = pin | {'zip_bytes': 3}
        class Response:
            url = 'https://example.blob.core.windows.net/a?signed=do-not-log'
            headers = {}
            def __enter__(self): self.data = io.BytesIO(b'zip'); return self
            def __exit__(self, *args): pass
            def read(self, n): return self.data.read(n)
        class Opener:
            def open(self, request, timeout):
                self.request = request
                return Response()
        opener = Opener()
        with tempfile.TemporaryDirectory() as d, patch.object(p, 'api', return_value=Response.url) as api, patch.object(p.urllib.request, 'build_opener', return_value=opener):
            target = Path(d) / 'package.zip'; p.download(target, pin, 'sensitive-test-token')
            self.assertEqual(target.read_bytes(), b'zip')
            self.assertIsNone(opener.request.get_header('Authorization'))
            self.assertNotIn('sensitive-test-token', str(opener.request.headers))
            self.assertEqual(api.call_args.args[1], 'sensitive-test-token')

    def test_download_overrun_truncation_and_deadline_remove_partial(self):
        pin, _ = p.load_approval(); pin = pin | {'zip_bytes': 3}
        for data, expired in [(b'abcd', False), (b'ab', False), (b'abc', True)]:
            class Response:
                url = 'https://example.blob.core.windows.net/a'
                headers = {}
                def __enter__(self): self.data = io.BytesIO(data); return self
                def __exit__(self, *args): pass
                def read(self, n): return self.data.read(n)
            class Opener:
                def open(self, request, timeout): return Response()
            clock = [0, 181] if expired else [0, 1, 2, 3]
            with self.subTest(data=data, expired=expired), tempfile.TemporaryDirectory() as d, patch.object(p, 'api', return_value=Response.url), patch.object(p.urllib.request, 'build_opener', return_value=Opener()), patch.object(p.time, 'monotonic', side_effect=clock):
                target = Path(d) / 'package.zip'
                with self.assertRaises(p.Invalid): p.download(target, pin, 'never-forward')
                self.assertFalse(target.exists())

    def test_api_redirect_uses_no_bearer_in_new_blob_request(self):
        pin, _ = p.load_approval()
        class Opener:
            def open(self, request, timeout):
                self.request = request
                raise urllib.error.HTTPError(request.full_url, 302, '', {'Location': 'https://example.blob.core.windows.net/a'}, None)
        opener = Opener()
        with patch.object(p.urllib.request, 'build_opener', return_value=opener):
            location = p.api('actions/artifacts/1/zip', 'sensitive-test-token', True)
        self.assertEqual(location, 'https://example.blob.core.windows.net/a')
        self.assertEqual(opener.request.host, 'api.github.com')


if __name__ == '__main__':
    unittest.main()
