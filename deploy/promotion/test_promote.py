import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('promote',HERE/'promote.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
sys.path.insert(0,str(HERE.parent/'msf'))
from test_identity import fixture, SOURCE

class PromotionGuards(unittest.TestCase):
    def setUp(self):
        self.receipts=json.loads((HERE/'test_receipts.json').read_text());self.pin=copy.deepcopy(p.PIN)
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
    def tearDown(self):p.PIN=self.pin;self.tmp.cleanup()
    def metadata(self,r=None):
        d=r or self.receipts;p.validate_metadata(d['run'],d['jobs'],d['artifact'])
    def test_exact_original_attempt1_provenance(self):self.metadata()
    def test_original_provenance_changes_fail(self):
        for key,value in [('id',1),('run_attempt',2),('workflow_id',1),('path','other.yml'),('event','workflow_dispatch'),('head_branch','other'),('head_sha','a'*40),('conclusion','failure')]:
            with self.subTest(key=key):
                r=copy.deepcopy(self.receipts);r['run'][key]=value
                with self.assertRaises(AssertionError):self.metadata(r)
        r=copy.deepcopy(self.receipts);r['run']['head_repository']['id']=1
        with self.assertRaises(AssertionError):self.metadata(r)
    def test_exact_original_jobs_required(self):
        for key,value in [('id',1),('run_attempt',2),('head_sha','a'*40),('name','other'),('conclusion','failure')]:
            with self.subTest(key=key):
                r=copy.deepcopy(self.receipts);r['jobs']['jobs'][0][key]=value
                with self.assertRaises(AssertionError):self.metadata(r)
    def test_artifact_identity_and_expiry(self):
        for key,value in [('id',1),('name','other'),('digest','sha256:'+'0'*64),('expired',True),('expires_at','2000-01-01T00:00:00Z')]:
            with self.subTest(key=key):
                r=copy.deepcopy(self.receipts);r['artifact'][key]=value
                with self.assertRaises(AssertionError):self.metadata(r)
        r=copy.deepcopy(self.receipts);r['artifact']['workflow_run']['id']=2
        with self.assertRaises(AssertionError):self.metadata(r)
    def package(self,extra=None,manifest_change=False,inner_change=False):
        archive,config,manifest=fixture(self.root)
        p.PIN.update(source=SOURCE,image=config,archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),oci_manifest=manifest)
        original={k:p.PIN[k] for k in ['source','image','archive_sha256','ops_sha256']}
        if manifest_change:original['ops_sha256']='0'*64
        path=self.root/'package.zip'
        with zipfile.ZipFile(path,'w') as z:
            z.writestr('backend-image.json',json.dumps(original))
            z.writestr('backend-image.tar.gz',archive.read_bytes()+(b'x' if inner_change else b''))
            if extra:z.writestr(extra,b'x')
        p.PIN['zip_sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        return path
    def test_full_package_classic_checksum_and_oci_binding(self):
        identity=p.validate_package(self.package(),self.root/'out')
        self.assertEqual(identity['manifest'],p.PIN['oci_manifest'])
    def test_raw_zip_digest_failure_before_extract(self):
        path=self.package();path.write_bytes(path.read_bytes()+b'changed')
        with self.assertRaises(AssertionError):p.validate_package(path,self.root/'out')
        self.assertFalse((self.root/'out').exists())
    def test_extra_and_traversal_entries_rejected(self):
        for entry in ['../escape','unexpected']:
            with self.subTest(entry=entry):
                with self.assertRaises(AssertionError):p.validate_package(self.package(extra=entry),self.root/'out')
                self.assertFalse((self.root/'out').exists())
    def test_manifest_ops_cannot_be_relabelled(self):
        with self.assertRaises(AssertionError):p.validate_package(self.package(manifest_change=True),self.root/'out')
    def test_full_inner_checksum_required(self):
        with self.assertRaises(AssertionError):p.validate_package(self.package(inner_change=True),self.root/'out')

if __name__=='__main__':unittest.main()
