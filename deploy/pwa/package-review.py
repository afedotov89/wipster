#!/usr/bin/env python3
"""Package the exact local integrated source without touching git index or owner files.
Run from repo root only after verification. Output lives in the PWA evidence folder.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--base', required=True)
args = parser.parse_args()
out = args.out.resolve()
out.mkdir(parents=True, exist_ok=True)
def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])
tracked = set(git('ls-files', '-z').decode().rstrip('\0').split('\0'))
extra = [
    '.dockerignore', '.github/workflows/pwa-ci.yml',
    'backend/apps/accounts/migrations/0006_web_channel.py',
    'backend/apps/accounts/migrations/0007_webbrowser.py',
    'backend/project/pwa.py', 'backend/project/web.py',
    'backend/tests_cloud/test_pwa_static.py', 'backend/tests_cloud/test_web.py',
    'deploy/pwa', 'docs/pwa-delivery-contract.md', 'docs/pwa-deployment-review-plan.md',
    'docs/pwa-architecture-review.md', 'frontend/e2e', 'frontend/playwright.config.ts',
    'frontend/public', 'frontend/scripts', 'frontend/src/base.css', 'frontend/src/browser',
]
selected = set(tracked)
for name in extra:
    p = root / name
    if not p.exists():
        raise SystemExit('Missing candidate input: ' + name)
    for f in p.rglob('*') if p.is_dir() else [p]:
        if f.is_file() and '__pycache__' not in f.parts:
            selected.add(str(f.relative_to(root)))
for forbidden in ['docs/landing-assistant-context.md', 'product-description.txt']:
    if forbidden in selected:
        raise SystemExit('Owner file unexpectedly selected: ' + forbidden)
entries = []
contents = {}
for name in sorted(selected):
    p = root / name
    if not p.is_file():
        raise SystemExit('Deleted/missing source needs explicit handling: ' + name)
    data = p.read_bytes()
    contents[name] = data
    entries.append({'path': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                    'mode': '755' if p.stat().st_mode & 0o111 else '644'})
head = git('rev-parse', 'HEAD').decode().strip()
local_tracking = git('rev-parse', 'origin/main').decode().strip()
(out / 'maintenance-base.diff').write_bytes(git('diff', '--binary', 'origin/main', args.base, '--'))
body = {'base_head': args.base, 'source_commit': head, 'local_tracking_ref_origin_main': local_tracking, 'files': entries}
canonical = json.dumps(body, sort_keys=True, separators=(',', ':')).encode()
fingerprint = hashlib.sha256(canonical).hexdigest()
manifest = {**body, 'source_fingerprint_sha256': fingerprint,
            'scope': 'All tracked source + explicitly selected untracked PWA implementation; excludes owner files, foreign untracked/evidence and git metadata.'}
manifest_data = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
(out / 'source-manifest.json').write_bytes(manifest_data)
# Include untracked implementation in a concrete review diff, including binary icons.
diff = git('diff', '--binary', args.base, 'HEAD', '--')
for name in sorted(selected - tracked):
    r = subprocess.run(['git', '-C', str(root), 'diff', '--no-index', '--binary', '--', '/dev/null', name], capture_output=True)
    if r.returncode not in (0, 1):
        raise SystemExit(r.stderr.decode())
    diff += r.stdout
(out / 'integrated.diff').write_bytes(diff)
with (out / 'integrated-source.tar.gz').open('wb') as file:
    with gzip.GzipFile(fileobj=file, mode='wb', mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w') as tar:
            for name in [*sorted(contents), 'REVIEW-SOURCE.json']:
                data = manifest_data if name == 'REVIEW-SOURCE.json' else contents[name]
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = 0o644 if name == 'REVIEW-SOURCE.json' else (root / name).stat().st_mode & 0o777
                tar.addfile(info, io.BytesIO(data))
# Detect edits racing with packaging, rather than assigning the manifest to other bytes.
for name, data in contents.items():
    if (root / name).read_bytes() != data:
        raise SystemExit('Source changed while packaging: ' + name)
static = []
for p in sorted((root / 'frontend/dist').rglob('*')):
    if p.is_file():
        static.append({'path': str(p.relative_to(root / 'frontend/dist')), 'size': p.stat().st_size,
                       'sha256': hashlib.sha256(p.read_bytes()).hexdigest()})
(out / 'static-manifest.json').write_text(json.dumps({'source_fingerprint_sha256': fingerprint, 'files': static}, indent=2) + '\n')
print(json.dumps({'base_head': args.base, 'source_commit': head, 'source_fingerprint_sha256': fingerprint, 'files': len(entries),
                  'archive_sha256': hashlib.sha256((out / 'integrated-source.tar.gz').read_bytes()).hexdigest(),
                  'diff_sha256': hashlib.sha256(diff).hexdigest()}, indent=2))
