"""Execute actual receiver/release shells at isolated IO boundaries, no daemon/live host.

The file-lock adapter uses real OS flock on the inherited descriptor on Mac and
Linux. Docker/nginx/backup are faultable IO boundaries; PG behavior has separate
real PostgreSQL18 evidence, and the actual retained package has a separate full
positive verification. This fixture never pretends to be a real deployment.
"""
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import promote as p
from test_promote import image_fixture

DOCKER = r'''
import hashlib,json,os,sys
from pathlib import Path
r=Path(os.environ['WIPSTER_ROOT']); a=sys.argv[1:];active=(r/'runtime/routing/active.conf').read_text()
def event(**extra):
 with (r/'events.jsonl').open('a') as f:f.write(json.dumps(dict(tool='docker',args=a,candidate='api-green' in active,**extra))+'\n')
if a[0]=='load':
 event(archive=hashlib.sha256(Path(a[a.index('-i')+1]).read_bytes()).hexdigest());sys.exit(0)
if a[:2]==['image','inspect']:
 event();print(json.dumps(dict(id=os.environ['FIXTURE_CONFIG'],source=os.environ['FIXTURE_IMAGE_SOURCE'],os='linux',architecture='amd64')));sys.exit(0)
if 'run' in a and a[-3:]==['python','-B','-']:
 payload=sys.stdin.buffer.read();event(helper_sha256=hashlib.sha256(payload).hexdigest())
 assert '-T' in a and '--no-deps' in a and '--rm' in a
 assert hashlib.sha256(payload).hexdigest()==os.environ['FIXTURE_HELPER']
 sys.exit(4 if os.environ['WIPSTER_FAULT']=='migration' else 0)
event()
if a[0]=='inspect':
 if '.Image' in a[2]: print(os.environ['FIXTURE_OLD_IMAGE'] if os.environ['WIPSTER_FAULT']!='reused' else 'sha256:'+'f'*64)
 else:print('unhealthy' if os.environ['WIPSTER_FAULT']=='unhealthy' else 'healthy')
elif 'ps' in a and '-q' in a:print('fake-api-id')
elif 'nginx' in a and '-t' in a and 'api-green' in active and os.environ['WIPSTER_FAULT']=='nginx':sys.exit(3)
'''
CURL = r'''
import os,re,sys
from pathlib import Path
root=Path(os.environ['WIPSTER_ROOT']);active=(root/'runtime/routing/active.conf').read_text()
release=re.search(r'X-Wipster-Release "([^"]+)"',active).group(1)
fault=os.environ['WIPSTER_FAULT']=='readiness' and 'api-green' in active
print('HTTP/1.1 503 Service Unavailable' if fault else 'HTTP/1.1 200 OK')
print('X-Wipster-Release: '+release+'\r\n');sys.exit(22 if fault else 0)
'''
FLOCK = r'''
import fcntl,json,os,sys,time
from pathlib import Path
r=Path(os.environ['WIPSTER_ROOT'])
def event(name):
 with (r/'events.jsonl').open('a') as f:f.write(json.dumps(dict(tool='lock',event=name))+'\n')
assert sys.argv[1:]==['-w','600','9'];event('requested');deadline=time.monotonic()+3
while True:
 try:fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB);break
 except BlockingIOError:
  if time.monotonic()>deadline:sys.exit(1)
  time.sleep(.02)
event('acquired')
'''
UTILS = {
 'df':"print('Filesystem 1024-blocks Used Available Capacity Mounted on');print('fixture 99999999 1 99999998 1% /')",
 'stat':"import os,sys;assert sys.argv[1:3]==['-c','%s'];print(os.stat(sys.argv[3]).st_size)",
 'sha256sum':"import hashlib,sys;from pathlib import Path;print(hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest()+'  '+sys.argv[1])",
 'timeout':"import subprocess,sys;sys.exit(subprocess.run(sys.argv[2:],timeout=int(sys.argv[1])).returncode)",
 'sleep':'',
}

class Bindings(unittest.TestCase):
    def setUp(self):self.pin,self.proofs=p.load_approval()
    def test_receiver_outputs_preserve_original_image_and_require_new_ops(self):
        outputs=p.delivery_outputs(self.pin,self.proofs)
        self.assertEqual(outputs['source'],self.pin['source'])
        self.assertEqual(outputs['ops'],self.pin['required_installed_ops_sha256'])
        self.assertNotEqual(outputs['ops'],self.pin['image_ops_sha256'])
        metadata={'source':self.pin['source'],'image':self.pin['image'],'archive_sha256':self.pin['archive_sha256'],'ops_sha256':self.pin['image_ops_sha256']}
        provenance={'source':self.pin['source'],'run':str(self.pin['build_run']),'attempt':str(self.pin['artifact_build_attempt']),'image':self.pin['image'],'context_sha256':self.pin['context_sha256'],'static_manifest_sha256':self.pin['static_manifest_sha256']}
        p.validate_provenance(metadata,provenance,self.pin)
        with self.assertRaises(p.Invalid):p.validate_provenance(metadata|{'ops_sha256':outputs['ops']},provenance,self.pin)
        for field,value in [('required_installed_ops_sha256',self.pin['image_ops_sha256']),('required_installed_ops_source',self.pin['source']),('required_installed_ops_source',self.pin['observed_installed_ops']['source'])]:
            with self.subTest(field=field,value=value),self.assertRaises(p.Invalid):p.delivery_outputs(self.pin|{field:value},self.proofs)
    def test_runtime_helper_maintenance_and_harness_tamper_rejected(self):
        for name in ['ops_sha256','source','base_source']:
            proofs=copy.deepcopy(self.proofs);proofs['proofs/delivery-ops.json'][name]='0'*40
            with self.subTest(name=name),self.assertRaises(p.Invalid):p.validate_delivery_ops(self.pin,proofs)
        with tempfile.TemporaryDirectory() as d:
            import shutil
            directory=Path(d)/'candidate';shutil.copytree(p.HERE,directory,ignore=shutil.ignore_patterns('__pycache__'))
            for name in ['runtime_ops/pwa_migrate.py','runtime_ops/systemd/wipster-backup.service','compatibility/fixture.py']:
                file=directory/name;before=file.read_bytes();file.write_bytes(before+b'\n# changed\n')
                with self.subTest(name=name),self.assertRaises(p.Invalid):p.validate_delivery_ops(self.pin,self.proofs,directory)
                file.write_bytes(before)
    def test_compatibility_source_attempt_job_and_proof_mismatch_rejected(self):
        original=self.proofs['proofs/compatibility-ci.json']
        for section,field,value in [('run','head_sha',self.pin['source']),('run','run_attempt',2),('run','conclusion','failure'),('artifact','digest','sha256:'+'0'*64)]:
            ci=copy.deepcopy(original);ci[section][field]=value
            with self.subTest(section=section,field=field),self.assertRaises(p.Invalid):p.validate_compatibility_metadata(ci['run'],ci['jobs'],ci['artifact'],self.pin,self.proofs)
        proofs=copy.deepcopy(self.proofs);proofs['proofs/compatibility.json']['cases'].pop()
        with self.assertRaises(p.Invalid):p.validate_delivery_ops(self.pin,proofs)

class ReceiverRelease(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.pin,self.proofs=p.load_approval();r=self.root
        for name in ['bin','config','runtime/routing','releases','fake-bin','image']:(r/name).mkdir(parents=True,exist_ok=True)
        (r/'config/approved_artifact.json').write_bytes((p.HERE/'runtime_ops/approved_artifact.json').read_bytes())
        self.old='20261113T215948Z-6e275c26c1f9bcd2722445641a3c7982a8c56ef6-1804140';self.old_image='sha256:'+'d'*64
        self.oldrecord=r/'releases'/self.old;self.oldrecord.mkdir();(self.oldrecord/'record.json').write_text(json.dumps(dict(slot='blue',image=self.old_image)))
        self.oldroute=f'add_header X-Wipster-Release "{self.old}" always;\nproxy_pass http://api-blue:8080;\n'
        (r/'runtime/routing'/f'{self.old}.conf').write_text(self.oldroute);(r/'runtime/routing/active.conf').write_text(self.oldroute);(r/'runtime/current').symlink_to(self.oldrecord)
        (r/'config/ops.sha256').write_text(self.pin['required_installed_ops_sha256']);(r/'config/ops.source').write_text(self.pin['required_installed_ops_source']);(r/'config/rollout-enabled').touch()
        # Execute the actual prepare.sh install loop, adapting only privileged IO.
        installer=r/'fake-bin/sudo';installer.write_text(f'#!{sys.executable}\n'+r'''
import os,shutil,sys
from pathlib import Path
args=sys.argv[1:];assert args[:2]==['-n','install'];args=args[2:]
assert args[:4]==['-o','root','-g','root'];args=args[4:];assert args[:2]==['-m','755'];src,dst=args[2:]
shutil.copyfile(src,dst);os.chmod(dst,0o755)
''');installer.chmod(0o755)
        self.env=dict(os.environ,WIPSTER_ROOT=str(r),WIPSTER_FAULT='none',FIXTURE_OLD_IMAGE=self.old_image,PATH=str(r/'fake-bin')+os.pathsep+os.environ['PATH'])
        source=p.HERE/'runtime_ops';script=(source/'prepare.sh').read_text();loop=script[script.index('for f in receive.sh'):].split('\ndone',1)[0]+'\ndone\n'
        subprocess.run(['bash','-e','-c',loop],env=self.env|{'SOURCE':str(source),'ROOT':str(r)},check=True,capture_output=True,timeout=10)
        self.assertEqual((r/'bin/pwa_migrate.py').read_bytes(),(source/'pwa_migrate.py').read_bytes())
        self.assertEqual((r/'bin/pwa_migrate.py').stat().st_mode&0o777,0o755)
        (r/'bin/validate_env.py').write_text("# synthetic configuration boundary only\n")
        (r/'bin/backup.sh').write_text(f'#!{sys.executable}\n'+r'''
import json,os,sys
from pathlib import Path
r=Path(os.environ['WIPSTER_ROOT'])
with (r/'events.jsonl').open('a') as f:f.write(json.dumps(dict(tool='backup',args=sys.argv[1:]))+'\n')
print('synthetic-before-migration.dump');sys.exit(1 if os.environ['WIPSTER_FAULT']=='backup' else 0)
''');(r/'bin/backup.sh').chmod(0o755)
        for name,body in dict(UTILS,docker=DOCKER,curl=CURL,flock=FLOCK).items():
            file=r/'fake-bin'/name;file.write_text(f'#!{sys.executable}\n'+body);file.chmod(0o755)
        self.archive,self.fixture_pin,_=image_fixture(r/'image',self.pin)
        self.env.update(FIXTURE_CONFIG=self.fixture_pin['image'],FIXTURE_IMAGE_SOURCE=self.pin['source'],FIXTURE_HELPER=p.digest(source/'pwa_migrate.py'))
    def events(self):
        path=self.root/'events.jsonl';return [json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []
    def receive(self,fault='none',ops=None,source=None):
        self.env['WIPSTER_FAULT']=fault
        command='deploy '+self.pin['source']+' '+self.fixture_pin['image']+' '+self.fixture_pin['archive_sha256']+' '+(ops or self.pin['required_installed_ops_sha256'])+' '+(source or self.pin['required_installed_ops_source'])+' 987654321'
        return subprocess.run(['bash',str(self.root/'bin/receive.sh')],env=self.env|{'SSH_ORIGINAL_COMMAND':command},input=self.archive.read_bytes(),capture_output=True,timeout=20)
    def test_installed_hash_source_and_gate_reject_before_load(self):
        for ops,source in [(self.pin['image_ops_sha256'],None),(None,self.pin['observed_installed_ops']['source']),(None,self.pin['source'])]:
            result=self.receive(ops=ops,source=source);self.assertNotEqual(result.returncode,0,result.stderr)
        (self.root/'config/rollout-enabled').unlink();result=self.receive();self.assertNotEqual(result.returncode,0)
        self.assertFalse(any(e.get('tool')=='docker' for e in self.events()))
        self.assertEqual((self.root/'runtime/current').resolve(),self.oldrecord)
    def test_real_operation_lock_blocks_receiver_before_gate_or_load(self):
        lock=(self.root/'runtime/operation.lock').open('a+');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        (self.root/'config/rollout-enabled').unlink()
        command='deploy '+self.pin['source']+' '+self.fixture_pin['image']+' '+self.fixture_pin['archive_sha256']+' '+self.pin['required_installed_ops_sha256']+' '+self.pin['required_installed_ops_source']+' 987654321'
        process=subprocess.Popen(['bash',str(self.root/'bin/receive.sh')],env=self.env|{'SSH_ORIGINAL_COMMAND':command},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            deadline=time.monotonic()+2
            while not self.events() and time.monotonic()<deadline:time.sleep(.02)
            self.assertEqual(self.events(),[{'tool':'lock','event':'requested'}]);self.assertIsNone(process.poll())
            fcntl.flock(lock,fcntl.LOCK_UN);lock.close();_,err=process.communicate(self.archive.read_bytes(),timeout=5)
            self.assertNotEqual(process.returncode,0,err);self.assertFalse(any(e.get('tool')=='docker' for e in self.events()))
        finally:
            lock.close()
            if process.poll() is None:process.kill();process.communicate(timeout=5)
    def test_receive_release_success_records_distinct_ops_and_app_rollback(self):
        result=self.receive();self.assertEqual(result.returncode,0,result.stderr.decode())
        current=(self.root/'runtime/current').resolve();self.assertNotEqual(current,self.oldrecord)
        record=json.loads((current/'record.json').read_text());self.assertEqual(record['source'],self.pin['source']);self.assertEqual(record['ops_sha256'],self.pin['required_installed_ops_sha256']);self.assertEqual(record['ops_source'],self.pin['required_installed_ops_source']);self.assertEqual(record['image_config_sha256'],self.fixture_pin['image']);self.assertEqual(record['promotion_run'],987654321);self.assertNotIn('build_provenance',record)
        events=self.events();migration=[e for e in events if 'helper_sha256' in e];self.assertEqual(len(migration),1);self.assertEqual(migration[0]['helper_sha256'],self.env['FIXTURE_HELPER'])
        self.assertLess(next(i for i,e in enumerate(events) if e['tool']=='backup'),next(i for i,e in enumerate(events) if 'helper_sha256' in e))
        self.assertEqual([e['archive'] for e in events if 'archive' in e],[self.fixture_pin['archive_sha256']])
        before=len(events);rollback=subprocess.run(['bash',str(self.root/'bin/release.sh'),'rollback',self.old],env=self.env,capture_output=True,timeout=10)
        self.assertEqual(rollback.returncode,0,rollback.stderr.decode());self.assertEqual((self.root/'runtime/current').resolve(),self.oldrecord);self.assertEqual((self.root/'runtime/routing/active.conf').read_text(),self.oldroute)
        after=self.events()[before:];self.assertFalse(any('helper_sha256' in e or e['tool']=='backup' for e in after));self.assertFalse(any(any(x in e.get('args',[]) for x in ['restore','migrate','down','prune']) for e in after))
        self.assertEqual(list((self.root/'runtime').glob('image.*')),[])
    def test_unexpected_loaded_identity_rejected_before_release(self):
        for key,value in [('FIXTURE_CONFIG','sha256:'+'0'*64),('FIXTURE_IMAGE_SOURCE','0'*40)]:
            original=self.env[key];self.env[key]=value
            result=self.receive();self.assertNotEqual(result.returncode,0)
            self.assertEqual((self.root/'runtime/current').resolve(),self.oldrecord)
            self.assertFalse(any('helper_sha256' in e for e in self.events()))
            self.assertEqual(list((self.root/'runtime').glob('image.*')),[])
            self.env[key]=original
    def test_reused_old_slot_blocks_app_rollback_without_schema_changes(self):
        result=self.receive();self.assertEqual(result.returncode,0,result.stderr.decode())
        current=(self.root/'runtime/current').resolve();route=(self.root/'runtime/routing/active.conf').read_bytes()
        self.env['WIPSTER_FAULT']='reused';before=len(self.events())
        rollback=subprocess.run(['bash',str(self.root/'bin/release.sh'),'rollback',self.old],env=self.env,capture_output=True,timeout=10)
        self.assertNotEqual(rollback.returncode,0);self.assertIn(b'Slot has been reused',rollback.stderr)
        self.assertEqual((self.root/'runtime/current').resolve(),current);self.assertEqual((self.root/'runtime/routing/active.conf').read_bytes(),route)
        self.assertFalse(any('helper_sha256' in e or 'reload' in e.get('args',[]) or e['tool']=='backup' for e in self.events()[before:]))
    def test_failure_boundaries_preserve_old_slot_and_only_stop_candidate(self):
        for fault in ['backup','migration','unhealthy','nginx','readiness']:
            with self.subTest(fault=fault):
                before=len(self.events());result=self.receive(fault=fault);self.assertNotEqual(result.returncode,0,result.stderr.decode())
                self.assertEqual((self.root/'runtime/current').resolve(),self.oldrecord);self.assertEqual((self.root/'runtime/routing/active.conf').read_text(),self.oldroute)
                events=self.events()[before:];stops=[e for e in events if 'stop' in e.get('args',[])];self.assertEqual(len(stops),1);self.assertIn('wipster-green',stops[0]['args']);self.assertNotIn('wipster-blue',stops[0]['args'])
                if fault=='backup':self.assertFalse(any('helper_sha256' in e for e in events))
                if fault=='migration':self.assertFalse(any('up' in e.get('args',[]) and 'api' in e['args'] for e in events))
                if fault=='nginx':self.assertFalse(any('reload' in e.get('args',[]) and e['candidate'] for e in events if e['tool']=='docker'))
                self.assertFalse(any(any(x in e.get('args',[]) for x in ['restore','down','prune']) for e in events))

class RootRollback(unittest.TestCase):
    def test_exact_forward_inverse_and_drift_rejection(self):
        from root_guard import candidate
        before=(p.HERE/'root/before.conf').read_bytes();after=(p.HERE/'root/proposed.conf').read_bytes()
        self.assertEqual(candidate(before),after)
        self.assertEqual(candidate(after,rollback=True),before)
        for current,rollback in [(before+b'\n',False),(after+b'\n',True),(before,True),(after,False)]:
            with self.subTest(rollback=rollback),self.assertRaises(p.Invalid):candidate(current,rollback=rollback)
