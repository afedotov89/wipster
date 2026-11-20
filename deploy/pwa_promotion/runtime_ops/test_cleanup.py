import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
class CleanupBoundaries(unittest.TestCase):
    def test_closed_gate_never_touches_docker(self):
        with tempfile.TemporaryDirectory() as directory:
            env=os.environ.copy();env['WIPSTER_ROOT']=directory
            result=subprocess.run(['bash',str(HERE/'cleanup-auth.sh')],env=env,capture_output=True)
            self.assertEqual(result.returncode,0)
            self.assertEqual(list(Path(directory).iterdir()),[])
    def test_current_image_mismatch_refuses_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for name in ('config','runtime','releases/old','fake-bin'): (root/name).mkdir(parents=True)
            (root/'config/rollout-enabled').touch()
            (root/'runtime/current').symlink_to(root/'releases/old')
            (root/'releases/old/status').write_text('healthy')
            (root/'releases/old/record.json').write_text('{"slot":"blue","image":"sha256:'+'a'*64+'"}')
            fake=root/'fake-bin/docker'
            fake.write_text('#!/bin/sh\ncase "$1" in inspect) echo sha256:wrong;; *) echo container-id;; esac\n')
            fake.chmod(0o755)
            env=os.environ.copy();env.update(WIPSTER_ROOT=directory,PATH=str(root/'fake-bin')+os.pathsep+env['PATH'])
            result=subprocess.run(['bash',str(HERE/'cleanup-auth.sh')],env=env,capture_output=True)
            self.assertNotEqual(result.returncode,0)
if __name__=='__main__': unittest.main()
