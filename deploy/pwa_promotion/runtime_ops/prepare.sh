#!/usr/bin/env bash
# Run on msf from a reviewed copy: bash prepare.sh <deployment-source-dir>
# Installs Wipster files only. Does not start containers, nginx, timers or deploy.
set -euo pipefail
SOURCE=${1:?Path containing reviewed deploy/msf files}
OPS_SOURCE=${2:-}
[[ -z $OPS_SOURCE || $OPS_SOURCE =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid reviewed ops source' >&2; exit 2; }
ROOT=/srv/wipster
[[ $(id -un) == fedotov ]] || { echo 'Run as fedotov on msf' >&2; exit 1; }
[[ $(hostname -s) == msf ]] || { echo 'Expected msf host' >&2; exit 1; }
sudo -n install -d -o root -g root -m 755 "$ROOT" "$ROOT/bin" "$ROOT/config" "$ROOT/config/nginx" "$ROOT/site"
sudo -n install -d -o fedotov -g fedotov -m 700 "$ROOT/secrets" "$ROOT/runtime" "$ROOT/backups" "$ROOT/releases"
# Parent is private; routing alone must be traversable by nginx uid 101.
chmod 711 "$ROOT/runtime"
install -d -m 755 "$ROOT/runtime/routing"
for f in receive.sh release.sh backup.sh cleanup-auth.sh validate_env.py verify_archive.py verify_loaded.py pwa_migrate.py; do
    sudo -n install -o root -g root -m 755 "$SOURCE/$f" "$ROOT/bin/$f"
done
for f in compose.infra.yaml compose.app.yaml images.env proxy_wsgi.py approved_artifact.json; do
    sudo -n install -o root -g root -m 644 "$SOURCE/$f" "$ROOT/config/$f"
done
sudo -n install -o root -g root -m 644 "$SOURCE/nginx/gateway.conf" "$ROOT/config/nginx/gateway.conf"
sudo -n install -o root -g root -m 644 "$SOURCE/site/index.html" "$ROOT/site/index.html"
python3 "$SOURCE/ops_hash.py" "$SOURCE" | sudo -n tee "$ROOT/config/ops.sha256" > /dev/null
if [[ -n $OPS_SOURCE ]]; then
    printf '%s\n' "$OPS_SOURCE" | sudo -n tee "$ROOT/config/ops.source" > /dev/null
    sudo -n chmod 644 "$ROOT/config/ops.source"
fi
# Generate server-only credentials; never overwrite established secrets.
python3 - "$ROOT" <<'PY'
import os,secrets,sys
from pathlib import Path
root=Path(sys.argv[1])
db=root/'secrets/db.env'; api=root/'secrets/api.env'
if not db.exists() and not api.exists():
    password=secrets.token_hex(32)
    for path,text in [(db,f'POSTGRES_DB=wipster\nPOSTGRES_USER=wipster\nPOSTGRES_PASSWORD={password}\n'),
                      (api,f'DEBUG=false\nSECRET_KEY={secrets.token_urlsafe(64)}\nDATABASE_URL=postgresql://wipster:{password}@db:5432/wipster\nALLOWED_HOSTS=wipster.fedotovs.net\nYANDEX_ENABLED=true\nYANDEX_CLIENT_ID=\nYANDEX_CLIENT_SECRET=\nGOOGLE_ENABLED=false\nOTP_PROVIDER=disabled\nDEV_OTP_ENABLED=false\nTRUST_PROXY_TLS=true\nCORS_ALLOWED_ORIGINS=\n')]:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f: f.write(text)
elif not (db.exists() and api.exists()):
    raise SystemExit('Partial secrets configuration; operator must reconcile without overwriting')
routing=root/'runtime/routing'
if (routing/'active.conf').is_symlink() and not (root/'runtime/current').exists():
    (routing/'active.conf').unlink()
if not (routing/'active.conf').exists():
    (routing/'maintenance.conf').write_text('return 503;\n')
    (routing/'maintenance.conf').chmod(0o644)
    (routing/'active.conf').write_text('return 503;\n')
    (routing/'active.conf').chmod(0o644)
PY
echo 'Wipster prepared only; rollout gate closed until lead accepts combined source and real Yandex OAuth configuration.'
