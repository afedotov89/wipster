#!/usr/bin/env bash
# Wipster-only, future reviewed timer. Never starts containers or migrates.
set -euo pipefail
ROOT=${WIPSTER_ROOT:-/srv/wipster}
[[ -f $ROOT/config/rollout-enabled ]] || exit 0
exec 9>"$ROOT/runtime/operation.lock"
# Do not queue maintenance behind a rollout or backup.
flock -n 9 || exit 0
CURRENT=$(readlink "$ROOT/runtime/current" 2>/dev/null || true)
[[ -n $CURRENT && -f $CURRENT/record.json && $(cat "$CURRENT/status") == healthy ]] || exit 0
read -r SLOT IMAGE < <(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["slot"],d["image"])' "$CURRENT/record.json")
[[ $SLOT =~ ^(blue|green)$ && $IMAGE =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2
APP=(docker compose -p "wipster-$SLOT" -f "$ROOT/config/compose.app.yaml")
export WIPSTER_SLOT=$SLOT WIPSTER_IMAGE=$IMAGE
CONTAINER=$("${APP[@]}" ps -q api)
[[ -n $CONTAINER && $(docker inspect --format '{{.Image}}' "$CONTAINER") == "$IMAGE" ]] || exit 1
# Existing active API only; DB statement/lock deadlines prevent long maintenance.
"${APP[@]}" exec -T -e 'PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=3000' api python manage.py cleanup_yandex_attempts
