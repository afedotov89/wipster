#!/usr/bin/env python3
"""Verify deployment log sinks without backend/provider credentials or images."""
import importlib.util
import re
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent

class CallbackLogging(unittest.TestCase):
    def test_proxy_logs_omit_callback_query(self):
        tls=(HERE/'nginx/wipster.conf').read_text()
        log_format=tls.split('log_format wipster_safe ',1)[1].split(';',1)[0]
        self.assertIn('$uri',log_format)
        for variable in ('$request_uri','$request"','$args','$query_string','$http_authorization'):
            self.assertNotIn(variable,log_format)
        # nginx errors may include the full request, including OAuth parameters.
        self.assertEqual(tls.count('error_log /dev/null;'),2)
        self.assertIn('error_log /dev/null;', (HERE/'nginx/wipster.http.conf').read_text())
        gateway=(HERE/'nginx/gateway.conf').read_text()
        self.assertIn('access_log off;',gateway)
        self.assertIn('error_log /dev/null;',gateway)
    @unittest.skipUnless(importlib.util.find_spec('gunicorn'), 'gunicorn must be installed for runtime log check')
    def test_gunicorn_captures_callback_exception_and_console(self):
        command=(HERE/'compose.app.yaml').read_text().split('    command: [',1)[1].split(']',1)[0]
        flags=[]
        for name in ('--access-logfile','--error-logfile'):
            sink=re.search(re.escape(name)+r', ([^, ]+)',command).group(1)
            self.assertEqual(sink,'/dev/null')
            flags.extend([name,sink])
        self.assertIn('--capture-output',command)
        flags.append('--capture-output')
        with tempfile.TemporaryDirectory() as directory:
            marker='SYNTHETIC_OAUTH_SECRET_MUST_NOT_APPEAR'
            Path(directory,'probe.py').write_text('''import logging,sys
def application(env,start):
    value=env['QUERY_STRING']
    print(value,flush=True)
    print(value,file=sys.stderr,flush=True)
    logging.warning(value)
    raise RuntimeError(value)
''')
            listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
            port=listener.getsockname()[1]
            process=subprocess.Popen([sys.executable,'-m','gunicorn','probe:application','--chdir',directory,'--bind',f'fd://{listener.fileno()}','--workers','1',*flags],pass_fds=(listener.fileno(),),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            listener.close()
            try:
                for attempt in range(30):
                    try:
                        urllib.request.urlopen(f'http://127.0.0.1:{port}/api/v1/auth/yandex/callback?code={marker}&state={marker}',timeout=.3)
                    except urllib.error.HTTPError as exc:
                        self.assertEqual(exc.code,500)
                        self.assertNotIn(marker.encode(),exc.read())
                        break
                    except (OSError,TimeoutError):
                        if process.poll() is not None: self.fail('Gunicorn exited before probe')
                        time.sleep(.1)
                else: self.fail('Gunicorn probe timed out')
            finally:
                process.terminate()
                output,error=process.communicate(timeout=5)
            self.assertNotIn(marker.encode(),output+error)

if __name__=='__main__': unittest.main()
