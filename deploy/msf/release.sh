#!/usr/bin/env bash
# Only receive.sh or an operator may call this. Caller holds operation.lock.
# rollback is app-only: schemas must remain backward-compatible; never auto-restore data.
set -euo pipefail
umask 077
ROOT=${WIPSTER_ROOT:-/srv/wipster}
ACTION=${1:?deploy or rollback}
INFRA=(docker compose --env-file "$ROOT/config/images.env" -f "$ROOT/config/compose.infra.yaml")
app() { WIPSTER_IMAGE="$IMAGE" WIPSTER_SLOT="$SLOT" docker compose -p "${WIPSTER_APP_PREFIX:-wipster}-$SLOT" -f "$ROOT/config/compose.app.yaml" "$@"; }
route() {
    local conf=$1
    cp "$ROOT/runtime/routing/$conf" "$ROOT/runtime/routing/active.next" || return 1
    chmod 644 "$ROOT/runtime/routing/active.next" || return 1
    python3 -c 'import os,sys;os.replace(sys.argv[1],sys.argv[2])' "$ROOT/runtime/routing/active.next" "$ROOT/runtime/routing/active.conf" || return 1
    "${INFRA[@]}" exec -T gateway nginx -t || return 1
    "${INFRA[@]}" exec -T gateway nginx -s reload
}
healthy() {
    local attempt
    for ((attempt=1; attempt<=40; attempt++)); do
        if [[ $(docker inspect --format '{{.State.Health.Status}}' "$(app ps -q api)" 2>/dev/null || true) == healthy ]]; then return 0; fi
        sleep 3
    done
    return 1
}
probe() {
    local expected=$1 attempt headers
    for ((attempt=1; attempt<=10; attempt++)); do
        if headers=$(curl --fail --silent --show-error --max-time 8 -D - -o /dev/null -H 'Host: wipster.fedotovs.net' -H 'X-Real-IP: 127.0.0.1' "http://127.0.0.1:${WIPSTER_PORT:-18180}/readyz"); then
            if printf '%s' "$headers" | tr -d '\r' | grep -Fq "X-Wipster-Release: $expected"; then return 0; fi
        fi
        sleep 1
    done
    return 1
}
if [[ $ACTION == rollback ]]; then
    exec 9>"$ROOT/runtime/operation.lock"
    flock -w 600 9
    TARGET=${2:?release record name}
    [[ $TARGET =~ ^[0-9TZ-]+-[0-9a-f]{40}(-[0-9]+)?$ ]] || exit 2
    RECORD="$ROOT/releases/$TARGET"
    test -f "$RECORD/record.json"
    read -r SLOT IMAGE < <(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["slot"],d["image"])' "$RECORD/record.json")
    [[ $SLOT =~ ^(blue|green)$ && $IMAGE =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2
    # Do not silently recreate a reused slot with an obsolete schema.
    [[ $(docker inspect --format '{{.Image}}' "$(app ps -q api)") == "$IMAGE" ]] || { echo 'Slot has been reused; prepare a reviewed redeploy of this image' >&2; exit 1; }
    healthy
    OLD_ROUTE=maintenance.conf
    CURRENT_RECORD=$(readlink "$ROOT/runtime/current" 2>/dev/null || true)
    [[ -z $CURRENT_RECORD ]] || OLD_ROUTE="$(basename "$CURRENT_RECORD").conf"
    if ! route "$TARGET.conf" || ! probe "$TARGET"; then route "$OLD_ROUTE"; echo 'Rollback failed; previous route restored' >&2; exit 1; fi
    ln -s "$RECORD" "$ROOT/runtime/current.next"
    python3 -c 'import os,sys;os.replace(sys.argv[1],sys.argv[2])' "$ROOT/runtime/current.next" "$ROOT/runtime/current"
    echo "App-only rollback healthy: $TARGET"
    exit 0
fi
[[ $ACTION == deploy ]] || exit 2
SOURCE=${2:?source SHA} IMAGE=${3:?image ID} ARCHIVE=${4:?archive checksum}
SLOT=blue
OLD_RECORD=$(readlink "$ROOT/runtime/current" 2>/dev/null || true)
OLD_ROUTE=maintenance.conf
[[ -z $OLD_RECORD ]] || OLD_ROUTE="$(basename "$OLD_RECORD").conf"
if [[ -n $OLD_RECORD ]]; then
    OLD_SLOT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["slot"])' "$OLD_RECORD/record.json")
    [[ $OLD_SLOT == blue ]] && SLOT=green
fi
RELEASE=$(date -u +%Y%m%dT%H%M%SZ)-$SOURCE-$$
RECORD="$ROOT/releases/$RELEASE"
mkdir "$RECORD"
python3 - "$RECORD/record.json" "$SOURCE" "$IMAGE" "$ARCHIVE" "$SLOT" <<'PY'
import json,sys,datetime
from pathlib import Path
path,source,image,archive,slot=sys.argv[1:]
with open(path,'w') as f:
    ops=(Path(path).parents[2]/'config/ops.sha256').read_text().strip()
    json.dump(dict(source=source,image=image,archive_sha256=archive,ops_sha256=ops,slot=slot,created_at=datetime.datetime.now(datetime.timezone.utc).isoformat()),f,indent=2)
PY
FAILED=1
cleanup() {
    if [[ $FAILED == 1 ]]; then
        # The old API stays alive; only Wipster routing is restored.
        route "$OLD_ROUTE" || echo 'Wipster gateway restore requires operator attention' >&2
        if [[ -n $OLD_RECORD ]]; then
            ln -s "$OLD_RECORD" "$ROOT/runtime/current.restore"
            python3 -c 'import os,sys;os.replace(sys.argv[1],sys.argv[2])' "$ROOT/runtime/current.restore" "$ROOT/runtime/current"
        fi
        app stop api >/dev/null || true
        echo failed > "$RECORD/status"
    fi
}
trap cleanup EXIT
# Existing volumes are backed up even if the database had been stopped.
EXISTING_DB=0
docker volume inspect "${WIPSTER_DB_VOLUME:-wipster-postgres-data}" >/dev/null 2>&1 && EXISTING_DB=1
"${INFRA[@]}" up -d --wait --wait-timeout 100 db gateway
if [[ $EXISTING_DB == 1 ]]; then
    "$ROOT/bin/backup.sh" --locked | tee "$RECORD/backup.txt"
else
    echo 'New Wipster volume; no previous database exists' > "$RECORD/backup.txt"
fi
app run --rm --no-deps api python manage.py check --deploy --fail-level ERROR > "$RECORD/check.log" 2>&1
# One migration runner, protected by receiver flock and GitHub concurrency.
app run --rm --no-deps api python manage.py migrate --noinput > "$RECORD/migrate.log" 2>&1
app up -d --no-deps api
healthy
# Resolve candidate only after it is healthy. nginx resolves on config reload.
printf 'add_header X-Wipster-Release "%s" always;\nproxy_pass http://api-%s:8080;\n' "$RELEASE" "$SLOT" > "$ROOT/runtime/routing/$RELEASE.conf"
chmod 644 "$ROOT/runtime/routing/$RELEASE.conf"
route "$RELEASE.conf"
probe "$RELEASE"
ln -s "$RECORD" "$ROOT/runtime/current.next"
python3 -c 'import os,sys;os.replace(sys.argv[1],sys.argv[2])' "$ROOT/runtime/current.next" "$ROOT/runtime/current"
echo healthy > "$RECORD/status"
FAILED=0
trap - EXIT
echo "Wipster release healthy: $RELEASE ($IMAGE); previous slot retained"
