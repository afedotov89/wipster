#!/usr/bin/env bash
# Isolated LOCAL/CI smoke only. Never invoke on msf; never uses production secrets.
set -euo pipefail
[[ $(hostname -s) != msf ]] || { echo 'Smoke is prohibited on msf' >&2; exit 2; }
IMAGE=${1:?built backend image}
SOURCE=$(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ $SOURCE =~ ^[0-9a-f]{40}$ ]] || exit 2
HERE=$(cd "$(dirname "$0")" && pwd)
export WIPSTER_ROOT
WIPSTER_ROOT=$(mktemp -d)
export WIPSTER_INFRA_PROJECT="wipster-smoke-$$" WIPSTER_APP_PREFIX="wipster-smoke-$$"
export WIPSTER_DATA_NETWORK="wipster-smoke-data-$$" WIPSTER_EDGE_NETWORK="wipster-smoke-edge-$$" WIPSTER_DB_VOLUME="wipster-smoke-db-$$"
export WIPSTER_PORT
WIPSTER_PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
mkdir -p "$WIPSTER_ROOT"/{config/nginx,bin,secrets,runtime/routing,backups,releases}
cp "$HERE"/*.yaml "$HERE/images.env" "$HERE/proxy_wsgi.py" "$WIPSTER_ROOT/config/"
python3 "$HERE/ops_hash.py" "$HERE" > "$WIPSTER_ROOT/config/ops.sha256"
cp "$HERE/nginx/gateway.conf" "$WIPSTER_ROOT/config/nginx/"
cp "$HERE"/*.sh "$WIPSTER_ROOT/bin/"
printf 'return 503;\n' > "$WIPSTER_ROOT/runtime/routing/maintenance.conf"
cp "$WIPSTER_ROOT/runtime/routing/maintenance.conf" "$WIPSTER_ROOT/runtime/routing/active.conf"
# Explicitly synthetic configuration in a short-lived isolated test network only.
python3 - "$WIPSTER_ROOT" <<'PY'
import secrets,sys
from pathlib import Path
p=Path(sys.argv[1]); password=secrets.token_hex(32)
(p/'secrets/db.env').write_text(f'POSTGRES_USER=wipster\nPOSTGRES_DB=wipster\nPOSTGRES_PASSWORD={password}\n')
(p/'secrets/api.env').write_text(f'DEBUG=false\nSECRET_KEY={secrets.token_urlsafe(64)}\nDATABASE_URL=postgresql://wipster:{password}@db:5432/wipster\nALLOWED_HOSTS=wipster.fedotovs.net\nGOOGLE_ENABLED=true\nGOOGLE_CLIENT_ID=smoke-not-provider.apps.googleusercontent.com\nOTP_PROVIDER=disabled\nDEV_OTP_ENABLED=false\nTRUST_PROXY_TLS=true\n')
PY
INFRA=(docker compose --env-file "$WIPSTER_ROOT/config/images.env" -f "$WIPSTER_ROOT/config/compose.infra.yaml")
IMAGE_ID=$(docker image inspect "$IMAGE" --format '{{.Id}}')
cleanup() {
    local slot
    for slot in blue green; do
        WIPSTER_SLOT=$slot WIPSTER_IMAGE=$IMAGE_ID docker compose -p "$WIPSTER_APP_PREFIX-$slot" -f "$WIPSTER_ROOT/config/compose.app.yaml" down --timeout 3 >/dev/null 2>&1 || true
    done
    "${INFRA[@]}" down --volumes --timeout 3 >/dev/null 2>&1 || true
    rm -rf "$WIPSTER_ROOT"
}
trap cleanup EXIT
"$HERE/release.sh" deploy "$SOURCE" "$IMAGE_ID" "$(printf '%064d' 0)"
FIRST=$(basename "$(readlink "$WIPSTER_ROOT/runtime/current")")
if [[ ${WIPSTER_SMOKE_BACKEND_TESTS:-0} == 1 ]]; then
    WIPSTER_SLOT=blue WIPSTER_IMAGE=$IMAGE_ID docker compose -p "$WIPSTER_APP_PREFIX-blue" -f "$WIPSTER_ROOT/config/compose.app.yaml" run --rm --no-deps -e DEBUG=true -e OTP_PROVIDER=development -e DEV_OTP_ENABLED=true -e GOOGLE_ENABLED=false -e ALLOWED_HOSTS=testserver,wipster.fedotovs.net api pytest -q -p no:cacheprovider tests_cloud
fi
# Second deployment exercises backup-before-migration and the other slot.
"$HERE/release.sh" deploy "$SOURCE" "$IMAGE_ID" "$(printf '%064d' 0)"
"$HERE/release.sh" rollback "$FIRST"
# Full logical restore into a new isolated database, never replacing authority.
"${INFRA[@]}" exec -T db createdb -U wipster wipster_restore_probe
DUMP=$(find "$WIPSTER_ROOT/backups" -name '*.dump' -print -quit)
"${INFRA[@]}" exec -T db pg_restore -U wipster -d wipster_restore_probe --exit-on-error < "$DUMP"
"${INFRA[@]}" exec -T db psql -U wipster -d wipster_restore_probe -Atc 'SELECT COUNT(*) > 0 FROM django_migrations' | grep -qx t
# Deliberate invalid candidate must leave old routing and current record intact.
cp "$WIPSTER_ROOT/secrets/api.env" "$WIPSTER_ROOT/secrets/api.saved"
printf '\nGOOGLE_CLIENT_ID=\n' >> "$WIPSTER_ROOT/secrets/api.env"
if "$HERE/release.sh" deploy "$SOURCE" "$IMAGE_ID" "$(printf '%064d' 0)"; then echo 'Invalid candidate unexpectedly deployed' >&2; exit 1; fi
mv "$WIPSTER_ROOT/secrets/api.saved" "$WIPSTER_ROOT/secrets/api.env"
test "$(basename "$(readlink "$WIPSTER_ROOT/runtime/current")")" = "$FIRST"
curl --fail --silent --show-error --max-time 8 -H 'X-Real-IP: 203.0.113.12' "http://127.0.0.1:$WIPSTER_PORT/readyz"
echo 'PASS: production-mode containers, migrations, both slots, app rollback, failed candidate isolation, backup and full restore (synthetic provider config; no real Google E2E)'
