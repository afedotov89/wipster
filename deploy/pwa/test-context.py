#!/usr/bin/env python3
"""Local/CI context isolation + source completeness, never invokes Docker build."""
from pathlib import Path
import importlib.util,tempfile,subprocess,json,hashlib,tarfile
spec=importlib.util.spec_from_file_location('context',Path(__file__).with_name('context.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='wipster-clean-context-') as d:
 seed=Path(d)/'seed';seed.mkdir()
 for name in m.selected():
  p=seed/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((m.ROOT/name).read_bytes())
 sentinels=['docs/landing-assistant-context.md','product-description.txt','.env','backend/.env','backend/.venv/secret.py','frontend/node_modules/secret.ts','frontend/src/__tests__/token.test.ts','backend/tests_cloud/yandex_mock_wsgi.py']
 for name in sentinels:
  p=seed/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('FORBIDDEN SENTINEL')
 archive=Path(d)/'context.tar';m.package(archive,seed)
 # Build only extracted allowlisted bytes, never the contaminated seed tree.
 clean=Path(d)/'clean';clean.mkdir()
 with tarfile.open(archive) as t:
  for member in t:
   raw=t.extractfile(member).read();assert b'FORBIDDEN SENTINEL' not in raw
   p=clean/member.name;assert p.is_relative_to(clean);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
 (clean/'frontend/node_modules').symlink_to(m.ROOT/'frontend/node_modules',target_is_directory=True)
 subprocess.run(['npm','run','build'],cwd=clean/'frontend',check=True,timeout=120)
 def hashes(p):return{str(f.relative_to(p)):hashlib.sha256(f.read_bytes()).hexdigest()for f in p.rglob('*')if f.is_file()}
 assert hashes(clean/'frontend/dist')==hashes(m.ROOT/'frontend/dist'),'Clean context build differs from current dist'
 print(json.dumps({'allowlisted_files':len(m.selected()),'sentinels_excluded':len(sentinels),'clean_source_build_matches_current_dist':True,'image_build_performed':False,'pass':True}))
