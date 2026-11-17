"""End-to-end fake-Docker failure paths. Never accesses the Docker daemon."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = Path(__file__).with_name('image-smoke.py')
FAKE = '''#!PYTHON
import json,os,sys,time
args=sys.argv[1:]
with open(os.environ['CALLS'],'a') as file:file.write(json.dumps({'args':args,'at':time.monotonic()})+'\\n')
if args[:2]==['image','inspect']:
 print(json.dumps([{'Os':'linux','Architecture':'amd64','Config':{'Labels':{'org.opencontainers.image.revision':'a'*40}}}]))
if 'pg_isready' in args:
 if os.environ['MODE']=='hung-check':time.sleep(10)
 sys.exit(1)
if args[:2]==['rm','-f']:
 if args[-1].endswith('-api') and os.environ['MODE']=='bad-cleanup':time.sleep(10)
 if args[-1].endswith('-db') and os.environ['MODE']=='bad-cleanup':sys.exit(42)
'''


class DeadlineFailurePaths(unittest.TestCase):
    def run_failure(self, mode):
        with tempfile.TemporaryDirectory(prefix='pwa-smoke-fake-') as d:
            root = Path(d); fake = root/'docker'
            fake.write_text(FAKE.replace('PYTHON', sys.executable)); fake.chmod(0o755)
            manifest = root/'static.json'; manifest.write_text(json.dumps({'source': 'a'*40, 'files': {}}))
            calls = root/'calls.jsonl'
            env = {**os.environ, 'PATH': str(root)+os.pathsep+os.environ['PATH'], 'CALLS': str(calls), 'MODE': mode}
            started = time.monotonic()
            result = subprocess.run([sys.executable, str(SCRIPT), 'sha256:'+'b'*64, 'a'*40,
                                     '--static-manifest', str(manifest), '--deadline', '1', '--cleanup-timeout', '.15'],
                                    env=env, capture_output=True, text=True, timeout=6)
            elapsed = time.monotonic()-started
            self.assertEqual(result.returncode, 1, result.stdout+result.stderr)
            self.assertLess(elapsed, 4.5, result.stdout)
            events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
            self.assertTrue(any(e.get('error')=='verification_deadline' for e in events), events)
            recorded = [json.loads(line) for line in calls.read_text().splitlines()]
            verification = [c for c in recorded if c['args'][:1] not in [['rm']] and c['args'][:2]!=['network','rm']]
            pg_checks=sum('pg_isready' in c['args'] for c in verification)
            self.assertGreaterEqual(pg_checks,1);self.assertLessEqual(pg_checks,4)
            self.assertFalse(any('manage.py' in c['args'] for c in verification))
            cleanup = [c['args'] for c in recorded if c['args'][:1]==['rm'] or c['args'][:2]==['network','rm']]
            self.assertEqual(len(cleanup), 3, recorded)
            self.assertTrue(cleanup[0][-1].endswith('-api')); self.assertTrue(cleanup[1][-1].endswith('-db'))
            self.assertEqual(cleanup[2], ['network','rm',cleanup[0][-1][:-4]])
            results = [e['cleanup'] for e in events if 'cleanup' in e]
            self.assertEqual(len(results),3)
            if mode=='bad-cleanup':
                self.assertTrue(results[0]['timeout']); self.assertEqual(results[1]['exit'],42); self.assertTrue(results[2]['ok'])
            else:
                self.assertTrue(all(c['ok'] for c in results))
            print(json.dumps({'case':mode,'elapsed_seconds':round(elapsed,3),'exit':result.returncode,'verification_commands':len(verification),'pg_checks':pg_checks,'cleanup':results}),flush=True)

    def test_never_ready_database_obeys_absolute_deadline(self):
        self.run_failure('never-ready')

    def test_hung_verification_subprocess_is_bounded(self):
        self.run_failure('hung-check')

    def test_cleanup_timeout_and_failure_do_not_skip_remaining_resources(self):
        self.run_failure('bad-cleanup')


if __name__ == '__main__':
    unittest.main()
