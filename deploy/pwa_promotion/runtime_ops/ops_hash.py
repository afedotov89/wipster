#!/usr/bin/env python3
"""Hash reviewed runtime inputs identically on Mac/Linux, with stable ordering."""
import hashlib
import sys
from pathlib import Path
root = Path(sys.argv[1] if len(sys.argv) > 1 else 'deploy/msf')
h = hashlib.sha256()
for path in sorted(p for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts):
    name = path.relative_to(root).as_posix()
    h.update(name.encode() + b'\0' + path.read_bytes() + b'\0')
print(h.hexdigest())
