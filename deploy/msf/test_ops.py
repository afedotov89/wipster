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
        self.api = dict(DEBUG='false', DEV_OTP_ENABLED='false', OTP_PROVIDER='disabled', GOOGLE_ENABLED='true', TRUST_PROXY_TLS='true', ALLOWED_HOSTS='wipster.fedotovs.net', CORS_ALLOWED_ORIGINS='', GOOGLE_CLIENT_ID='123456-owner.apps.googleusercontent.com', SECRET_KEY='s'*70, DATABASE_URL='postgresql://wipster:'+ 'p'*64 +'@db:5432/wipster')
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
    def test_missing_google_blocks_before_database(self):
        self.api['GOOGLE_CLIENT_ID']=''
        self.assertNotEqual(self.validate().returncode,0)
    def test_placeholder_google_rejected(self):
        self.api['GOOGLE_CLIENT_ID']='smoke.apps.googleusercontent.com'
        self.assertNotEqual(self.validate().returncode,0)
    def test_debug_and_otp_fail_closed(self):
        for key,value in [('DEBUG','true'),('OTP_PROVIDER','development'),('DEV_OTP_ENABLED','true')]:
            with self.subTest(key=key):
                original=self.api[key];self.api[key]=value
                self.assertNotEqual(self.validate().returncode,0);self.api[key]=original
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
