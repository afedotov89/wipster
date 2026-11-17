#!/usr/bin/env python3
"""Bounded isolated image verification. Only synthetic credentials/internal network.
Verification has one monotonic deadline; cleanup has a separate per-owned-action
allowance and always attempts api, db, network, even after a cleanup failure.
"""
import argparse
import json
import secrets
import subprocess
import sys
import time
from pathlib import Path

POSTGRES = 'postgres:18-alpine@sha256:1018733457011bf88d81db98cf43aac6d5150afc18787dbe204771fedf80ff95'


class SmokeDeadline(RuntimeError):
    pass


class Deadline:
    def __init__(self, seconds):
        self.end = time.monotonic() + seconds

    def remaining(self):
        remaining = self.end - time.monotonic()
        if remaining <= 0:
            raise SmokeDeadline('verification deadline expired')
        return remaining

    def pause(self, seconds):
        time.sleep(min(seconds, self.remaining()))
        self.remaining()

    def run(self, *args, check=True):
        # Never clamp an expired budget back to a positive subprocess timeout.
        result = subprocess.run(['docker', *args], capture_output=True, text=True,
                                timeout=min(90, self.remaining()))
        if check and result.returncode:
            raise RuntimeError(f'Docker {args[0]} failed ({result.returncode}): {result.stderr[-1000:]}')
        self.remaining()
        return result


def cleanup_owned(api, db, network, timeout):
    results = []
    for args in [('rm', '-f', '-v', api), ('rm', '-f', '-v', db), ('network', 'rm', network)]:
        record = {'resource': args[-1], 'operation': list(args[:2])}
        try:
            result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout)
            record.update(exit=result.returncode, ok=result.returncode == 0)
        except subprocess.TimeoutExpired:
            record.update(timeout=True, ok=False)
        except OSError as error:
            record.update(error=type(error).__name__, ok=False)
        results.append(record)
        print(json.dumps({'cleanup': record}), flush=True)
    return results


def verify(args, clock, api, db, network, expected):
    meta = json.loads(clock.run('image', 'inspect', args.image).stdout)[0]
    assert meta['Config']['Labels']['org.opencontainers.image.revision'] == args.source
    assert meta['Os'] == 'linux' and meta['Architecture'] == 'amd64'
    clock.run('network', 'create', '--internal', network)
    clock.run('run', '-d', '--platform', 'linux/amd64', '--pull', 'never', '--name', db, '--network', network, '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
              '--shm-size', '64m', '--tmpfs', '/var/lib/postgresql:size=256m', '-e', 'POSTGRES_USER=pwa', '-e', 'POSTGRES_DB=pwa', '-e', 'POSTGRES_PASSWORD=isolated-only', POSTGRES)
    while clock.run('exec', db, 'pg_isready', '-U', 'pwa', check=False).returncode:
        clock.pause(.5)
    env = ['-e', 'DEBUG=false', '-e', 'SECRET_KEY=' + secrets.token_urlsafe(64), '-e',
           f'DATABASE_URL=postgresql://pwa:isolated-only@{db}:5432/pwa', '-e',
           'ALLOWED_HOSTS=wipster.fedotovs.net', '-e', 'YANDEX_ENABLED=true', '-e',
           'YANDEX_CLIENT_ID=' + 'a'*32, '-e', 'TRUST_PROXY_TLS=true', '-e', 'OTP_PROVIDER=disabled']
    # Migration is named too: if its Docker client times out, cleanup still owns
    # the process/container, rather than leaving an anonymous --rm job behind.
    clock.run('create', '--platform', 'linux/amd64', '--pull', 'never', '--name', api, '--network', network, '--memory', '512m', '--cpus', '1',
              *env, args.image, 'python', 'manage.py', 'migrate', '--noinput')
    clock.run('start', '-a', api)
    result = json.loads(clock.run('inspect', api).stdout)[0]
    assert result['State']['ExitCode'] == 0, 'migration failed'
    clock.run('rm', api)
    clock.run('run', '-d', '--platform', 'linux/amd64', '--pull', 'never', '--name', api, '--network', network, '--memory', '512m', '--cpus', '1', *env, args.image)
    ready = "import urllib.request;urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8080/readyz',headers={'Host':'wipster.fedotovs.net','X-Forwarded-Proto':'https'}),timeout=2)"
    while clock.run('exec', api, 'python', '-c', ready, check=False).returncode:
        clock.pause(.5)
    code = '''import json,urllib.request,urllib.error,pathlib,hashlib
root=pathlib.Path('/app/pwa');build=json.loads((root/'pwa-build.json').read_text())
assert not pathlib.Path('/app/tests_cloud').exists()
assert not pathlib.Path('/app/.env').exists()
assert not pathlib.Path('/web').exists()
assert not pathlib.Path('/usr/local/bin/node').exists()
assert not pathlib.Path('/usr/local/bin/npm').exists()
assert not list(pathlib.Path('/app').rglob('node_modules'))
from django.db import connection
import os,django
os.environ['DJANGO_SETTINGS_MODULE']='project.settings';django.setup()
with connection.cursor() as cursor:
 cursor.execute("SELECT name FROM django_migrations WHERE app='accounts'")
 migrations={r[0] for r in cursor.fetchall()}
 assert {'0006_web_channel','0007_webbrowser'} <= migrations
checks=[('/',200,'text/html','no-cache'),('/sw.js',200,'text/javascript','no-cache'),('/manifest.webmanifest',200,'application/manifest+json','no-cache'),('/healthz',200,'application/json',None),('/readyz',200,'application/json',None),('/api/unknown',404,None,None),('/api/v1/web/sync/pull',401,'application/json','no-store'),('/api/v1/auth/yandex/callback',400,'text/html','no-store')]
for path,status,mime,cache in checks:
 req=urllib.request.Request('http://127.0.0.1:8080'+path,headers={'Host':'wipster.fedotovs.net','X-Forwarded-Proto':'https'})
 try:r=urllib.request.urlopen(req,timeout=3)
 except urllib.error.HTTPError as e:r=e
 with r:
  assert r.status==status,(path,r.status)
  if mime:assert r.headers['Content-Type'].startswith(mime),path
  if cache:assert r.headers['Cache-Control']==cache,path
  if path=='/':assert r.read()==(root/'index.html').read_bytes();assert "frame-ancestors 'none'" in r.headers['Content-Security-Policy']
  if path=='/sw.js':assert r.headers['Service-Worker-Allowed']=='/'
for relative in build['files']:
 file=root/relative.lstrip('/')
 req=urllib.request.Request('http://127.0.0.1:8080/'+relative.lstrip('/'),headers={'Host':'wipster.fedotovs.net','X-Forwarded-Proto':'https'})
 with urllib.request.urlopen(req,timeout=3) as r:
  assert r.read()==file.read_bytes(),relative
  if '/assets/' in '/'+relative.lstrip('/'):assert 'immutable' in r.headers['Cache-Control']
  mime={'.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json','.html':'text/html'}.get(file.suffix)
  if mime:assert r.headers['Content-Type'].startswith(mime),relative
actual={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
assert actual==expected,'Image static bytes differ from supplied exact verification manifest'
print(json.dumps({'checks':len(checks),'shell':build['shell'],'static_files':len(actual),'migrations':sorted(migrations),'pass':True}))
'''
    result = clock.run('exec', api, 'python', '-c', 'expected='+repr(expected['files'])+'\n'+code)
    print(result.stdout, end='', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image'); parser.add_argument('source')
    parser.add_argument('--static-manifest', required=True)
    parser.add_argument('--deadline', type=float, default=180)
    parser.add_argument('--cleanup-timeout', type=float, default=2)
    args = parser.parse_args()
    if not 0 < args.deadline or not 0 < args.cleanup_timeout <= 10:
        parser.error('positive verification deadline; cleanup-timeout must be 0..10 seconds')
    if len(args.source) != 40 or any(c not in '0123456789abcdef' for c in args.source) or not args.image.startswith('sha256:'):
        parser.error('immutable image ID and exact40hex source required')
    clock = Deadline(args.deadline)
    prefix = 'wipster-pwa-smoke-' + secrets.token_hex(6)
    api, db = prefix+'-api', prefix+'-db'
    passed = False
    try:
        expected = json.loads(Path(args.static_manifest).read_text())
        assert expected['source'] == args.source
        print(json.dumps({'owned': {'api': api, 'db': db, 'network': prefix}, 'deadline_seconds': args.deadline}), flush=True)
        verify(args, clock, api, db, prefix, expected)
        passed = True
    except (SmokeDeadline, subprocess.TimeoutExpired) as error:
        print(json.dumps({'pass': False, 'error': 'verification_deadline', 'type': type(error).__name__}), flush=True)
    except Exception as error:
        print(json.dumps({'pass': False, 'error': type(error).__name__, 'message': str(error)[:1500]}), flush=True)
    finally:
        cleaned = cleanup_owned(api, db, prefix, args.cleanup_timeout)
    return 0 if passed and all(r['ok'] for r in cleaned) else 1


if __name__ == '__main__':
    sys.exit(main())
