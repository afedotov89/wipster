#!/usr/bin/env python3
"""Bind a selected safe Docker inspection to checksum-approved archive identities."""
import json
import re
import sys

identity = json.load(open(sys.argv[1]))
loaded = json.load(sys.stdin)
assert re.fullmatch(r'sha256:[0-9a-f]{64}', identity['config']), 'Invalid config'
assert identity['manifest'] is None or re.fullmatch(r'sha256:[0-9a-f]{64}', identity['manifest']), 'Invalid manifest'
assert loaded['id'] in [identity['config'], identity['manifest']], 'Loaded identity mismatch'
assert loaded['source'] == identity['source'], 'Loaded source mismatch'
assert loaded['os'] == identity['os'] == 'linux', 'Loaded OS mismatch'
assert loaded['architecture'] == identity['architecture'] == 'amd64', 'Loaded architecture mismatch'
print(loaded['id'])
