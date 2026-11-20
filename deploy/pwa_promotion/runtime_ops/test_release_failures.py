#!/usr/bin/env python3
"""Exercise the real release shell script against disposable fake IO boundaries.

No Docker daemon, server, provider or production credentials are used. These
faults complement the recorded real-container smoke, including failures that
would be unsafe to inject into a live host.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent

DOCKER = r'''
import json,os,sys
from pathlib import Path
root=Path(os.environ['WIPSTER_ROOT']); args=sys.argv[1:]
active=(root/'runtime/routing/active.conf').read_text()
with (root/'events.jsonl').open('a') as f:
    f.write(json.dumps(dict(args=args,candidate='api-green' in active))+'\n')
mode=os.environ['WIPSTER_FAULT']
if args[:2]==['volume','inspect']: raise SystemExit(0)
if args and args[0]=='inspect': print('healthy'); raise SystemExit(0)
if 'ps' in args and '-q' in args: print('fake-api-id'); raise SystemExit(0)
if 'migrate' in args and mode=='migration': raise SystemExit(4)
if 'nginx' in args and '-t' in args and 'api-green' in active and mode=='nginx':
    raise SystemExit(3)
'''
CURL = r'''
import os,re,sys
from pathlib import Path
active=(Path(os.environ['WIPSTER_ROOT'])/'runtime/routing/active.conf').read_text()
release=re.search(r'X-Wipster-Release "([^"]+)"',active).group(1)
print('HTTP/1.1 503 Service Unavailable' if os.environ['WIPSTER_FAULT']=='readiness' else 'HTTP/1.1 200 OK')
print('X-Wipster-Release: '+release+'\r\n')
# Deliberately include the correct release header even in the failing response.
# A readiness probe must require the successful HTTP status too.
raise SystemExit(22 if os.environ['WIPSTER_FAULT']=='readiness' else 0)
'''

class ReleaseFailureSafety(unittest.TestCase):
    def exercise(self, fault):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve()
            for name in ('config','runtime/routing','releases','bin','fake-bin'):
                (root/name).mkdir(parents=True,exist_ok=True)
            old='20261113T000000Z-'+'0'*40+'-1'
            previous=root/'releases'/old;previous.mkdir()
            (previous/'record.json').write_text(json.dumps(dict(slot='blue',image='sha256:'+'d'*64)))
            (root/'runtime/current').symlink_to(previous)
            old_config=f'add_header X-Wipster-Release "{old}" always;\nproxy_pass http://api-blue:8080;\n'
            (root/'runtime/routing'/f'{old}.conf').write_text(old_config)
            (root/'runtime/routing/active.conf').write_text(old_config)
            (root/'config/ops.sha256').write_text('e'*64)
            (root/'bin/backup.sh').write_text('#!/bin/sh\n[ "$WIPSTER_FAULT" != backup ]\n')
            (root/'bin/backup.sh').chmod(0o755)
            for name,body in [('docker',DOCKER),('curl',CURL),('sleep','')]:
                p=root/'fake-bin'/name
                p.write_text(f'#!{sys.executable}\n'+body);p.chmod(0o755)
            env=os.environ.copy()
            env.update(WIPSTER_ROOT=str(root),WIPSTER_FAULT=fault,PATH=str(root/'fake-bin')+os.pathsep+env['PATH'])
            result=subprocess.run(['bash',str(HERE/'release.sh'),'deploy','a'*40,'sha256:'+'b'*64,'c'*64],env=env,capture_output=True,text=True,timeout=20)
            self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertEqual((root/'runtime/routing/active.conf').read_text(),old_config)
            self.assertEqual((root/'runtime/current').resolve(),previous)
            created=[p for p in (root/'releases').iterdir() if p!=previous]
            self.assertEqual(len(created),1)
            self.assertEqual((created[0]/'status').read_text().strip(),'failed')
            events=[json.loads(line) for line in (root/'events.jsonl').read_text().splitlines()]
            stops=[e['args'] for e in events if 'stop' in e['args']]
            self.assertEqual(len(stops),1)
            self.assertIn('wipster-green',stops[0])
            self.assertNotIn('wipster-blue',stops[0])
            for e in events:
                self.assertNotIn('prune',e['args'])
                self.assertNotIn('down',e['args'])
            return events

    def test_failed_backup_prevents_migration(self):
        events=self.exercise('backup')
        self.assertFalse(any('migrate' in e['args'] for e in events))

    def test_failed_migration_preserves_previous_app(self):
        events=self.exercise('migration')
        self.assertEqual(sum('migrate' in e['args'] for e in events),1)
        self.assertFalse(any('up' in e['args'] and 'api' in e['args'] for e in events))

    def test_invalid_nginx_candidate_is_never_reloaded(self):
        events=self.exercise('nginx')
        self.assertTrue(any('nginx' in e['args'] and '-t' in e['args'] and e['candidate'] for e in events))
        self.assertFalse(any('reload' in e['args'] and e['candidate'] for e in events))

    def test_readiness_503_with_valid_release_header_rolls_back(self):
        events=self.exercise('readiness')
        self.assertTrue(any('reload' in e['args'] and e['candidate'] for e in events))
        self.assertTrue(any('reload' in e['args'] and not e['candidate'] for e in events))

if __name__=='__main__': unittest.main()
