#!/usr/bin/env python3
"""Produce a clean explicit PWA context tar. Never builds or sends it anywhere."""
import argparse, hashlib, io, json, tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FILES=['frontend/package.json','frontend/package-lock.json','frontend/index.html','frontend/tsconfig.json','frontend/vite.config.ts','frontend/scripts/build-pwa.mjs','backend/requirements.lock','backend/manage.py','backend/entrypoint.sh','deploy/pwa/Dockerfile','.dockerignore','deploy/pwa/Dockerfile.dockerignore']
TREES={'frontend/src':{'.ts','.tsx','.css','.svg'},'frontend/public':{'.png','.svg','.ico','.webmanifest'},'backend/apps':{'.py'},'backend/project':{'.py'}}
def selected(root=ROOT):
 paths=set(FILES)
 for name,extensions in TREES.items():
  for p in (root/name).rglob('*'):
   if any(x in {'__tests__','__mocks__','__pycache__','node_modules','.venv','.git'} or x.startswith('.env') for x in p.parts):continue
   if p.is_symlink():raise ValueError('Symlink in context: '+str(p))
   if p.is_file() and p.suffix in extensions and '.test.' not in p.name and p.name!='test-setup.ts':paths.add(str(p.relative_to(root)))
 for name in paths:
  p=root/name
  if not p.is_file() or any((root/Path(*Path(name).parts[:i])).is_symlink() for i in range(1,len(Path(name).parts)+1)):raise ValueError('Invalid/symlink context source: '+name)
 return sorted(paths)
def package(target,root=ROOT):
 target=Path(target);data={name:(root/name).read_bytes() for name in selected(root)}
 manifest={'files':[{'path':name,'sha256':hashlib.sha256(raw).hexdigest(),'size':len(raw)} for name,raw in data.items()]}
 manifest['fingerprint_sha256']=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 with tarfile.open(target,'w') as archive:
  for name,raw in data.items():
   info=tarfile.TarInfo(name);info.size=len(raw);info.mode=(root/name).stat().st_mode&0o777;archive.addfile(info,io.BytesIO(raw))
 target.with_suffix('.json').write_text(json.dumps(manifest,indent=2)+'\n')
 for name,raw in data.items():
  if (root/name).read_bytes()!=raw:raise ValueError('Source changed during packaging')
 return manifest
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('output');args=parser.parse_args();result=package(args.output);print(json.dumps({'files':len(result['files']),'fingerprint_sha256':result['fingerprint_sha256']}))
