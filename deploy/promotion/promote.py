#!/usr/bin/env python3
"""Fetch only the pinned, historically verified backend artifact. No build path."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
PIN = json.loads((ROOT/'deploy/msf/approved_artifact.json').read_text())
API = 'https://api.github.com/repos/afedotov89/wipster/'
JOBS = {132026224233:'verify-build',132026224323:'cloud-regressions / backend',132026332951:'cloud-regressions / native-and-frontend'}


def validate_metadata(run, jobs, artifact):
    assert run['id'] == PIN['build_run'] and run['run_attempt'] == 1
    assert run['workflow_id'] == PIN['workflow_id'] and run['path'] == PIN['workflow_path']
    assert run['event'] == 'push' and run['head_branch'] == 'main' and run['head_sha'] == PIN['source']
    assert run['status'] == 'completed' and run['conclusion'] == 'success'
    for field in ('repository','head_repository'):
        assert run[field]['id'] == PIN['repository_id'] and run[field]['full_name'] == PIN['repository']
    assert jobs['total_count'] == len(jobs['jobs']) == 4, 'Unexpected historical job inventory'
    found = {}
    for job in jobs['jobs']:
        assert job['run_id'] == PIN['build_run'] and job['run_attempt'] == 1 and job['head_sha'] == PIN['source']
        if job['id'] in JOBS:
            assert job['name'] == JOBS[job['id']] and job['status'] == 'completed' and job['conclusion'] == 'success'
            assert job['steps'] and all(s['status']=='completed' and s['conclusion'] in ('success','skipped') for s in job['steps'])
            found[job['id']] = job['name']
        else:
            assert job['id'] == 132029456042 and job['name'] == 'deploy' and job['conclusion'] == 'skipped'
    assert found == JOBS
    assert artifact['id'] == PIN['artifact_id'] and artifact['name'] == PIN['artifact_name']
    assert artifact['digest'] == 'sha256:'+PIN['zip_sha256'] and not artifact['expired']
    assert 0 < artifact['size_in_bytes'] <= 128*1024*1024
    assert datetime.datetime.fromisoformat(artifact['expires_at'].replace('Z','+00:00')) > datetime.datetime.now(datetime.timezone.utc)
    owner=artifact['workflow_run']
    assert owner['id']==PIN['build_run'] and owner['head_sha']==PIN['source'] and owner['head_branch']=='main'
    assert owner['repository_id']==owner['head_repository_id']==PIN['repository_id']


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api(path, redirect=False):
    # Bearer is sent only to exact api.github.com, never forwarded to blob host.
    request=urllib.request.Request(API+path,headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request,timeout=20) as r:
            return json.loads(r.read(2*1024*1024+1))
    except urllib.error.HTTPError as e:
        if redirect and e.code in (301,302,303,307,308):
            location=e.headers['Location']; u=urllib.parse.urlsplit(location)
            assert u.scheme=='https' and not u.username and not u.password and u.hostname
            return location
        raise RuntimeError('GitHub metadata request failed') from None


def fetch_zip(destination):
    location=api(f"actions/artifacts/{PIN['artifact_id']}/zip",redirect=True)
    assert isinstance(location,str)
    # No bearer headers and no URL logging/persistence. Deadline and byte bound.
    start=time.monotonic(); count=0
    try:
        with urllib.request.urlopen(location,timeout=20) as response, destination.open('xb') as out:
            assert response.url.startswith('https://')
            while True:
                assert time.monotonic()-start < 180, 'Artifact download deadline'
                chunk=response.read(1024*1024)
                if not chunk: break
                count+=len(chunk); assert count<=128*1024*1024, 'ZIP exceeds bound'
                out.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise RuntimeError('Bounded artifact download failed (URL withheld)') from None


def validate_package(path, target):
    assert path.stat().st_size <= 128*1024*1024
    with path.open('rb') as f:
        assert hashlib.file_digest(f,'sha256').hexdigest()==PIN['zip_sha256'], 'Raw ZIP checksum mismatch'
    expected={'backend-image.json':65536,'backend-image.tar.gz':512*1024*1024}
    with zipfile.ZipFile(path) as archive:
        entries=archive.infolist()
        assert len(entries)==2 and {i.filename for i in entries}==set(expected), 'Unexpected ZIP entries'
        for entry in entries:
            assert not entry.is_dir() and not entry.flag_bits & 1
            mode=entry.external_attr >> 16
            assert mode & 0o170000 in (0,0o100000), 'Non-regular ZIP entry'
            assert 0 < entry.file_size <= expected[entry.filename]
        target.mkdir(mode=0o700)
        for entry in entries:
            with archive.open(entry) as source, (target/entry.filename).open('xb') as out:
                shutil.copyfileobj(source,out,1024*1024)  # ZipFile validates size and CRC.
    manifest=json.loads((target/'backend-image.json').read_text())
    assert manifest == {k:PIN[k] for k in ('source','image','archive_sha256','ops_sha256')}, 'Original published manifest changed'
    with (target/'backend-image.tar.gz').open('rb') as f:
        assert hashlib.file_digest(f,'sha256').hexdigest()==PIN['archive_sha256'], 'Inner checksum mismatch'
    result=subprocess.check_output([sys.executable,str(ROOT/'deploy/msf/verify_archive.py'),str(target/'backend-image.tar.gz'),PIN['source'],PIN['image'],'--json'],text=True)
    identity=json.loads(result)
    assert identity['manifest']==PIN['oci_manifest'], 'Wrong approved OCI manifest'
    return identity


def main():
    target=Path(sys.argv[1])
    ops_source=os.environ['OPS_SOURCE']; promotion_run=os.environ['GITHUB_RUN_ID']
    assert re.fullmatch(r'[0-9a-f]{40}',ops_source) and re.fullmatch(r'[1-9][0-9]{0,19}',promotion_run)
    assert os.environ['GITHUB_REPOSITORY']==PIN['repository'] and os.environ['GITHUB_REF']=='refs/heads/main'
    assert os.environ['GITHUB_EVENT_NAME']=='workflow_dispatch' and os.environ['GITHUB_SHA']==ops_source
    actual=subprocess.check_output([sys.executable,str(ROOT/'deploy/msf/ops_hash.py'),str(ROOT/'deploy/msf')],text=True).strip()
    assert actual==os.environ['EXPECTED_INSTALLED_OPS'], 'Unreviewed ops bytes'
    run=api(f"actions/runs/{PIN['build_run']}/attempts/1")
    jobs=api(f"actions/runs/{PIN['build_run']}/attempts/1/jobs?per_page=100")
    artifact=api(f"actions/artifacts/{PIN['artifact_id']}")
    validate_metadata(run,jobs,artifact)
    raw=target.with_suffix('.zip')
    try:
        fetch_zip(raw)
        identity=validate_package(raw,target)
    finally:
        raw.unlink(missing_ok=True)
    receipt=dict(original_artifact=PIN,installed_ops_sha256=actual,ops_source=ops_source,promotion_run=int(promotion_run),validated_archive_identity=identity)
    (target/'promotion-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    with open(os.environ['GITHUB_OUTPUT'],'a') as output:
        for key,value in dict(source=PIN['source'],config=PIN['image'],archive=PIN['archive_sha256'],ops=actual).items(): output.write(f'{key}={value}\n')
    print('Pinned historical provenance, raw ZIP, original manifest, inner archive and OCI identity verified')


if __name__=='__main__':
    try: main()
    except Exception as error:
        # Never expose signed URL, response bodies, OAuth or runtime config.
        print('Artifact-only promotion validation failed: '+type(error).__name__,file=sys.stderr)
        sys.exit(1)
