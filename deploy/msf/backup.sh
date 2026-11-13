#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=${WIPSTER_ROOT:-/srv/wipster}
if [[ ${1:-} != --locked ]]; then
    exec 9>"$ROOT/runtime/operation.lock"
    flock -w 600 9
fi
[[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -gt 5242880 ]] || { echo 'Less than 5GiB free; backup stopped' >&2; exit 1; }
STAMP=$(date -u +%Y%m%dT%H%M%S)-$$
TMP="$ROOT/backups/$STAMP.dump.partial"
trap 'rm -f "$TMP"' EXIT
docker compose --env-file "$ROOT/config/images.env" -f "$ROOT/config/compose.infra.yaml" exec -T db pg_dump -U wipster -d wipster -Fc > "$TMP"
test -s "$TMP"
docker compose --env-file "$ROOT/config/images.env" -f "$ROOT/config/compose.infra.yaml" exec -T db pg_restore --list < "$TMP" > /dev/null
mv "$TMP" "$ROOT/backups/$STAMP.dump"
python3 - "$ROOT/backups/$STAMP.dump" > "$ROOT/backups/$STAMP.dump.sha256" <<'PYHASH'
import hashlib,sys
with open(sys.argv[1],'rb') as f:
    print(hashlib.file_digest(f,'sha256').hexdigest()+'  '+sys.argv[1])
PYHASH
echo "Wipster backup verified: $STAMP.dump"
