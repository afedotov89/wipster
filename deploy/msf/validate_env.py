#!/usr/bin/env python3
"""Fail closed before even creating a production DB. Never print values."""
import os
import re
import stat
import sys
from pathlib import Path
from urllib.parse import urlsplit

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/srv/wipster')

def read(name):
    path = root / 'secrets' / name
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode != 0o600:
        raise SystemExit(f'{name}: expected mode 0600')
    result = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        key, value = line.split('=', 1)
        if key in result:
            raise SystemExit(f'{name}: duplicate key')
        result[key] = value
    return result

a = read('api.env')
d = read('db.env')
required = {'DEBUG': 'false', 'DEV_OTP_ENABLED': 'false', 'OTP_PROVIDER': 'disabled',
            'YANDEX_ENABLED': 'true', 'GOOGLE_ENABLED': 'false', 'TRUST_PROXY_TLS': 'true',
            'ALLOWED_HOSTS': 'wipster.fedotovs.net', 'CORS_ALLOWED_ORIGINS': ''}
for key, value in required.items():
    if a.get(key) != value:
        raise SystemExit(f'api.env: unsafe or missing {key}')
if not re.fullmatch(r'[a-f0-9]{32}', a.get('YANDEX_CLIENT_ID', '')):
    raise SystemExit('api.env: owner-supplied 32-character hex YANDEX_CLIENT_ID required')
if len(a.get('SECRET_KEY', '')) < 64 or a['SECRET_KEY'].startswith(('django-insecure', 'development')):
    raise SystemExit('api.env: strong SECRET_KEY required')
u = urlsplit(a.get('DATABASE_URL', ''))
if (u.scheme, u.hostname, u.port, u.username, u.path) != ('postgresql', 'db', 5432, 'wipster', '/wipster'):
    raise SystemExit('api.env: database must be isolated Wipster db')
if not u.password or len(u.password) < 40 or u.password != d.get('POSTGRES_PASSWORD'):
    raise SystemExit('database credentials missing or inconsistent')
if (d.get('POSTGRES_USER'), d.get('POSTGRES_DB')) != ('wipster', 'wipster'):
    raise SystemExit('db.env: unexpected database identity')
print('Production configuration validated (values withheld)')
