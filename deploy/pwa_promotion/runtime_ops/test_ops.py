#!/usr/bin/env python3
"""Focused checks of production guardrails and trusted ingress identity."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest

HERE = Path(__file__).resolve().parent

class DeploymentBoundaries(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root/'secrets').mkdir()
        self.api = dict(DEBUG='false', DEV_OTP_ENABLED='false', OTP_PROVIDER='disabled', YANDEX_ENABLED='true', GOOGLE_ENABLED='false', TRUST_PROXY_TLS='true', ALLOWED_HOSTS='wipster.fedotovs.net', CORS_ALLOWED_ORIGINS='', YANDEX_CLIENT_ID='0123456789abcdef0123456789abcdef', SECRET_KEY='s'*70, DATABASE_URL='postgresql://wipster:'+ 'p'*64 +'@db:5432/wipster')
        self.db = dict(POSTGRES_USER='wipster', POSTGRES_DB='wipster', POSTGRES_PASSWORD='p'*64)
    def tearDown(self):
        self.tmp.cleanup()
    def validate(self):
        for name,data in [('api.env',self.api),('db.env',self.db)]:
            p=self.root/'secrets'/name
            p.write_text(''.join(f'{k}={v}\n' for k,v in data.items()))
            p.chmod(0o600)
        return subprocess.run([sys.executable,str(HERE/'validate_env.py'),str(self.root)],capture_output=True)
    def test_valid_configuration(self):
        self.assertEqual(self.validate().returncode,0)
    def test_missing_yandex_blocks_before_database(self):
        self.api['YANDEX_CLIENT_ID']=''
        self.assertNotEqual(self.validate().returncode,0)
    def test_malformed_yandex_rejected(self):
        self.api['YANDEX_CLIENT_ID']='not-a-real-yandex-id'
        self.assertNotEqual(self.validate().returncode,0)
    def test_debug_and_otp_fail_closed(self):
        for key,value in [('DEBUG','true'),('OTP_PROVIDER','development'),('DEV_OTP_ENABLED','true'),('GOOGLE_ENABLED','true'),('YANDEX_ENABLED','false')]:
            with self.subTest(key=key):
                original=self.api[key];self.api[key]=value
                self.assertNotEqual(self.validate().returncode,0);self.api[key]=original
    def test_optional_yandex_secret_is_server_only(self):
        self.assertEqual(self.validate().returncode,0)
        self.api['YANDEX_CLIENT_SECRET']='private-server-only-test-value'
        result=self.validate()
        self.assertEqual(result.returncode,0)
        self.assertNotIn(self.api['YANDEX_CLIENT_SECRET'].encode(),result.stdout+result.stderr)
    def test_prepare_preserves_existing_secrets(self):
        # Exercise the embedded provisioning Python only; no SSH/sudo/install.
        script=(HERE/'prepare.sh').read_text().split("<<'PY'\n",1)[1].split('\nPY',1)[0]
        (self.root/'runtime/routing').mkdir(parents=True)
        command=[sys.executable,'-c',script,str(self.root)]
        subprocess.run(command,check=True,capture_output=True)
        paths=[self.root/'secrets'/name for name in ('api.env','db.env')]
        initial=[(p.read_bytes(),p.stat().st_mode) for p in paths]
        self.assertIn(b'YANDEX_CLIENT_ID=\n',initial[0][0])
        self.assertNotEqual(subprocess.run([sys.executable,str(HERE/'validate_env.py'),str(self.root)],capture_output=True).returncode,0)
        # Simulate the existing pre-transition server env; preparation must not
        # silently rewrite provider settings or established DB/Django secrets.
        paths[0].write_bytes(b'GOOGLE_ENABLED=true\nGOOGLE_CLIENT_ID=\nSECRET_KEY=existing-secret\n')
        initial=[(p.read_bytes(),p.stat().st_mode) for p in paths]
        subprocess.run(command,check=True,capture_output=True)
        self.assertEqual(initial,[(p.read_bytes(),p.stat().st_mode) for p in paths])
    def test_neighbour_database_rejected(self):
        self.api['DATABASE_URL']='postgresql://wipster:'+ 'p'*64 +'@plm-postgres:5432/wipster'
        self.assertNotEqual(self.validate().returncode,0)
    def test_credentials_never_in_error(self):
        self.api['DEBUG']='true'
        result=self.validate()
        self.assertNotIn(self.api['SECRET_KEY'].encode(),result.stdout+result.stderr)
        self.assertNotIn(self.db['POSTGRES_PASSWORD'].encode(),result.stdout+result.stderr)
    def test_ingress_wrapper_validates_single_address(self):
        calls=[]
        old=sys.modules.get('project.wsgi')
        sys.modules['project.wsgi']=types.SimpleNamespace(application=lambda env,start: calls.append(env['REMOTE_ADDR']) or [])
        try:
            spec=importlib.util.spec_from_file_location('proxy_wsgi',HERE/'proxy_wsgi.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            module.application({'HTTP_X_REAL_IP':'203.0.113.9'},lambda *a:None)
            module.application({'HTTP_X_REAL_IP':'203.0.113.9, 127.0.0.1'},lambda *a:None)
            self.assertEqual(calls,['203.0.113.9'])
        finally:
            if old is None: sys.modules.pop('project.wsgi',None)
            else: sys.modules['project.wsgi']=old
    def test_archive_rejects_other_service_tag(self):
        p=self.root/'bad.tar.gz'; data=json.dumps([{'RepoTags':['prism-hub:latest']}]).encode()
        with tarfile.open(p,'w:gz') as archive:
            m=tarfile.TarInfo('manifest.json');m.size=len(data);archive.addfile(m,io.BytesIO(data))
        result=subprocess.run([sys.executable,str(HERE/'verify_archive.py'),str(p),'0'*40,'sha256:'+'0'*64],capture_output=True)
        self.assertNotEqual(result.returncode,0)

if __name__=='__main__': unittest.main()
