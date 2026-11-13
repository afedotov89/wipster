"""Execute real archive/receiver/release/cleanup paths at disposable IO boundaries."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
SOURCE='a'*40
RUNTIME='sha256:'+'b'*64


def fixture(root, oci=True, change=None):
    config={'os':'linux','architecture':'amd64','config':{'Labels':{'org.opencontainers.image.revision':SOURCE}}}
    if change in ('source','platform'):
        if change=='source': config['config']['Labels']['org.opencontainers.image.revision']='c'*40
        else: config['architecture']='arm64'
    data=json.dumps(config).encode(); image='sha256:'+hashlib.sha256(data).hexdigest(); name='blobs/sha256/'+image.split(':')[1]
    layer=b'fixture-layer'; layer_digest='sha256:'+hashlib.sha256(layer).hexdigest(); layer_name='blobs/sha256/'+layer_digest.split(':')[1]
    legacy=[{'RepoTags':['wipster-backend:'+SOURCE],'Config':name,'Layers':[layer_name]}]
    members={name:data,layer_name:layer,'manifest.json':json.dumps(legacy).encode()}
    manifest=None
    if oci:
        layer_metadata={'mediaType':'application/vnd.oci.image.layer.v1.tar','digest':layer_digest,'size':len(layer)}
        if change=='missing_layer_media_type': del layer_metadata['mediaType']
        if change=='malformed_layer_digest': layer_metadata['digest']='sha256:malformed'
        if change=='wrong_layer_size': layer_metadata['size']=len(layer)+1
        m=json.dumps({'schemaVersion':2,'config':{'mediaType':'application/vnd.oci.image.config.v1+json','digest':image,'size':len(data)},'layers':[layer_metadata]}).encode()
        manifest='sha256:'+hashlib.sha256(m).hexdigest()
        descriptor={'digest':manifest,'size':len(m),'mediaType':'application/vnd.oci.image.manifest.v1+json','annotations':{'io.containerd.image.name':'docker.io/library/wipster-backend:'+SOURCE,'org.opencontainers.image.ref.name':SOURCE}}
        index={'schemaVersion':2,'manifests':[descriptor]}
        if change=='descriptor_platform': descriptor['platform']={'os':'linux','architecture':'arm64'}
        if change=='extra_descriptor': index['manifests'].append(descriptor)
        if change=='wrong_descriptor': descriptor['digest']='sha256:'+'d'*64
        if change=='malformed_descriptor': descriptor['digest']='sha256:$(bad)'
        if change=='wrong_oci_config': m=json.dumps({'schemaVersion':2,'config':{'digest':'sha256:'+'e'*64},'layers':[]}).encode();descriptor['digest']='sha256:'+hashlib.sha256(m).hexdigest();descriptor['size']=len(m)
        members.update({'index.json':json.dumps(index).encode(),'oci-layout':b'{"imageLayoutVersion":"1.0.0"}', 'blobs/sha256/'+descriptor['digest'].split(':')[1]:m})
        if change=='wrong_blob': members['blobs/sha256/'+descriptor['digest'].split(':')[1]]=b'{}'
        if change=='missing_blob': del members['blobs/sha256/'+descriptor['digest'].split(':')[1]]
        if change=='missing_index': del members['index.json']
        if change=='missing_layout': del members['oci-layout']
        if change=='missing_descriptor': index['manifests']=[];members['index.json']=json.dumps(index).encode()
    if change in ('missing_oci_config','wrong_oci_config_bytes','separate_equal_config'):
        # Preserve valid legacy bytes separately; OCI name/digest/descriptor stay unchanged.
        members['legacy-config.json']=members[name]
        legacy[0]['Config']='legacy-config.json'
        members['manifest.json']=json.dumps(legacy).encode()
        if change=='missing_oci_config': del members[name]
        if change=='wrong_oci_config_bytes': members[name]=b'X'*len(members[name])
    if change=='wrong_layer_bytes': members[layer_name]=b'X'*len(layer)
    if change=='missing_layer_blob': del members[layer_name]
    if change=='tag': legacy[0]['RepoTags']=['neighbor:latest']; members['manifest.json']=json.dumps(legacy).encode()
    if change=='wrong_config': members[name]=b'{}'
    path=root/'image.tar.gz'
    with tarfile.open(path,'w:gz') as archive:
        for name,data in members.items():
            entry=tarfile.TarInfo(name);entry.size=len(data);archive.addfile(entry,io.BytesIO(data))
    return path,image,manifest


DOCKER=r'''
import json,os,sys
from pathlib import Path
r=Path(os.environ['WIPSTER_ROOT']);a=sys.argv[1:]
with (r/'events').open('a') as f:f.write(json.dumps(a)+'\n')
if a[:2]==['image','inspect']:
 print(json.dumps(dict(id=os.environ['LOADED_ID'],source=os.environ.get('LOADED_SOURCE','a'*40),os='linux',architecture=os.environ.get('LOADED_ARCH','amd64'))))
elif a and a[0]=='inspect':
 print(os.environ.get('CONTAINER_IMAGE',os.environ['LOADED_ID']) if '{{.Image}}' in a else 'healthy')
elif 'ps' in a:print('container-id')
'''
CURL=r'''
import os,re
from pathlib import Path
s=(Path(os.environ['WIPSTER_ROOT'])/'runtime/routing/active.conf').read_text()
print('HTTP/1.1 200 OK\nX-Wipster-Release: '+re.search(r'X-Wipster-Release "([^"]+)"',s).group(1))
'''


class IdentityPaths(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        for name in ('bin','config','runtime/routing','secrets','releases','fake-bin'):(self.root/name).mkdir(parents=True)
        for name in ('receive.sh','release.sh','cleanup-auth.sh','verify_archive.py','verify_loaded.py','validate_env.py'):shutil.copy(HERE/name,self.root/'bin'/name);(self.root/'bin'/name).chmod(0o755)
        (self.root/'config/ops.sha256').write_text('e'*64)
        (self.root/'config/ops.source').write_text('f'*40)
        (self.root/'config/rollout-enabled').touch()
        (self.root/'runtime/routing/active.conf').write_text('return 503;\n')
        (self.root/'runtime/routing/maintenance.conf').write_text('return 503;\n')
        # Real validator, bounded test-only credentials.
        (self.root/'secrets/api.env').write_text('DEBUG=false\nDEV_OTP_ENABLED=false\nOTP_PROVIDER=disabled\nYANDEX_ENABLED=true\nGOOGLE_ENABLED=false\nTRUST_PROXY_TLS=true\nALLOWED_HOSTS=wipster.fedotovs.net\nCORS_ALLOWED_ORIGINS=\nYANDEX_CLIENT_ID='+'a'*32+'\nSECRET_KEY='+'s'*70+'\nDATABASE_URL=postgresql://wipster:'+'p'*64+'@db:5432/wipster\n')
        (self.root/'secrets/db.env').write_text('POSTGRES_USER=wipster\nPOSTGRES_DB=wipster\nPOSTGRES_PASSWORD='+'p'*64+'\n')
        for p in (self.root/'secrets').iterdir():p.chmod(0o600)
        for name,body in [('docker',DOCKER),('curl',CURL),('sleep',''),('df',"import os\nprint('Filesystem 1024-blocks Used Available Capacity Mounted on')\nprint('fixture 20000000 1000 '+os.environ.get('FAKE_FREE_KB','10000000')+' 1% /')\n")]:
            p=self.root/'fake-bin'/name;p.write_text('#!'+sys.executable+'\n'+body);p.chmod(0o755)
        self.env={**os.environ,'WIPSTER_ROOT':str(self.root),'LOADED_ID':RUNTIME,'PATH':str(self.root/'fake-bin')+os.pathsep+os.environ['PATH']}
        (self.root/'bin/backup.sh').write_text('#!/bin/sh\nexit 0\n');(self.root/'bin/backup.sh').chmod(0o755)
    def tearDown(self):self.tmp.cleanup()
    def events(self):return [json.loads(s) for s in (self.root/'events').read_text().splitlines()] if (self.root/'events').exists() else []
    def verify(self,change=None,oci=True):
        p,c,m=fixture(self.root,oci,change)
        return subprocess.run([sys.executable,str(HERE/'verify_archive.py'),str(p),SOURCE,c,'--json'],capture_output=True,text=True),p,c,m
    def test_archive_classic_and_oci_safe_output(self):
        for oci in (False,True):
            r,p,c,m=self.verify(oci=oci);self.assertEqual(r.returncode,0,r.stderr)
            self.assertEqual(json.loads(r.stdout),dict(config=c,manifest=m,source=SOURCE,os='linux',architecture='amd64'))
    def test_archive_negative_identity_boundaries(self):
        for change in ('source','platform','descriptor_platform','tag','wrong_config','extra_descriptor','wrong_descriptor','malformed_descriptor','wrong_blob','missing_blob','missing_index','missing_layout','missing_descriptor','wrong_oci_config'):
            with self.subTest(change=change):self.assertNotEqual(self.verify(change)[0].returncode,0)
    def test_exact_oci_config_and_layer_bytes_required(self):
        for change in ('missing_oci_config','wrong_oci_config_bytes','wrong_layer_bytes','missing_layer_blob','missing_layer_media_type','malformed_layer_digest','wrong_layer_size'):
            with self.subTest(change=change):
                result,_,_,_=self.verify(change)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(result.stdout,'')
    def test_distinct_legacy_and_oci_paths_with_equal_bytes(self):
        result,_,_,_=self.verify('separate_equal_config')
        self.assertEqual(result.returncode,0,result.stderr)
    def test_receiver_rejects_missing_or_corrupt_actual_blobs_before_load(self):
        for change in ('missing_oci_config','wrong_oci_config_bytes','wrong_layer_bytes','missing_layer_blob','missing_layer_media_type','malformed_layer_digest','wrong_layer_size'):
            with self.subTest(change=change):
                (self.root/'events').unlink(missing_ok=True)
                (self.root/'release-call').unlink(missing_ok=True)
                result,_,_=self.receive(change=change)
                self.assertNotEqual(result.returncode,0)
                self.assertFalse(any(event[0]=='load' for event in self.events()))
                self.assertFalse((self.root/'release-call').exists())
    def receive(self,loaded='manifest',change=None,loaded_source=None,loaded_arch=None):
        r,p,c,m=self.verify(change,oci=(loaded!='classic'))
        self.env['LOADED_ID']=m if loaded=='manifest' else c if loaded in ('config','classic') else RUNTIME
        self.env['LOADED_SOURCE']=loaded_source or SOURCE
        self.env['LOADED_ARCH']=loaded_arch or 'amd64'
        # Receiver path is real; capture boundary into release, exercised separately below.
        release=self.root/'bin/release.sh';release.write_text('#!'+sys.executable+'\nimport json,sys,os\nfrom pathlib import Path\nPath(os.environ["WIPSTER_ROOT"],"release-call").write_text(json.dumps(sys.argv[1:]))\n');release.chmod(0o755)
        self.env['SSH_ORIGINAL_COMMAND']='deploy '+SOURCE+' '+c+' '+hashlib.sha256(p.read_bytes()).hexdigest()+' '+'e'*64+' '+'f'*40+' 12345'
        result=subprocess.run(['bash',str(HERE/'receive.sh')],input=p.read_bytes(),env=self.env,capture_output=True,timeout=15)
        return result,c,m
    def test_receiver_classic_and_containerd_immutable_reference(self):
        for loaded in ('classic','config','manifest'):
            r,c,m=self.receive(loaded);self.assertEqual(r.returncode,0,r.stderr)
            call=json.loads((self.root/'release-call').read_text())
            self.assertEqual(call[2],m if loaded=='manifest' else c);self.assertEqual(call[4],c)
            self.assertEqual(call[5:],['f'*40,'12345'])
    def test_receiver_archive_failure_before_load(self):
        for change in ('source','platform','tag','missing_descriptor','wrong_oci_config'):
            with self.subTest(change=change):
                (self.root/'events').unlink(missing_ok=True)
                r,_,_=self.receive(change=change);self.assertNotEqual(r.returncode,0)
                self.assertFalse(any(e[0]=='load' for e in self.events()))
    def test_receiver_low_space_blocks_before_load(self):
        self.env['FAKE_FREE_KB']='4000000'
        r,_,_=self.receive();self.assertNotEqual(r.returncode,0)
        self.assertFalse(any(e[0]=='load' for e in self.events()))
    def test_receiver_loaded_mismatch_before_release(self):
        for kw in ({'loaded':'wrong'},{'loaded_source':'c'*40},{'loaded_arch':'arm64'}):
            with self.subTest(kw=kw):
                (self.root/'release-call').unlink(missing_ok=True)
                r,_,_=self.receive(**kw);self.assertNotEqual(r.returncode,0)
                self.assertFalse((self.root/'release-call').exists())
    def deploy(self):
        config='sha256:'+'c'*64
        r=subprocess.run(['bash',str(HERE/'release.sh'),'deploy',SOURCE,RUNTIME,'d'*64,config,'f'*40,'12345'],env=self.env,capture_output=True,text=True,timeout=15)
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        return (self.root/'runtime/current').resolve()
    def test_release_records_distinct_config_and_runtime(self):
        approved=json.loads((HERE/'approved_artifact.json').read_text())
        approved.update(source=SOURCE,image='sha256:'+'c'*64,archive_sha256='d'*64)
        (self.root/'config/approved_artifact.json').write_text(json.dumps(approved))
        record=json.loads((self.deploy()/'record.json').read_text())
        self.assertEqual(record['build_provenance'],approved)
        self.assertEqual(record['ops_sha256'],'e'*64)
        self.assertNotEqual(record['ops_sha256'],record['build_provenance']['ops_sha256'])
        self.assertEqual(record['image'],RUNTIME);self.assertEqual(record['image_config_sha256'],'sha256:'+'c'*64)
        self.assertEqual(record['ops_source'],'f'*40);self.assertEqual(record['promotion_run'],12345)
    def test_rollback_and_cleanup_verified_runtime_and_reused_slot(self):
        record=self.deploy()
        for bad in (False,True):
            self.env['CONTAINER_IMAGE']='sha256:'+'d'*64 if bad else RUNTIME
            rollback=subprocess.run(['bash',str(HERE/'release.sh'),'rollback',record.name],env=self.env,capture_output=True,timeout=15)
            cleanup=subprocess.run(['bash',str(HERE/'cleanup-auth.sh')],env=self.env,capture_output=True,timeout=15)
            self.assertEqual(rollback.returncode==0,not bad,rollback.stderr)
            self.assertEqual(cleanup.returncode==0,not bad,cleanup.stderr)
    def test_invalid_config_argument_rejected_before_release_io(self):
        r=subprocess.run(['bash',str(HERE/'release.sh'),'deploy',SOURCE,RUNTIME,'d'*64,'mutable:tag'],env=self.env,capture_output=True)
        self.assertNotEqual(r.returncode,0);self.assertFalse(self.events())

if __name__=='__main__':unittest.main()
