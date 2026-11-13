#!/usr/bin/env bash
# Installed root-owned. CI key is restricted to this command, without PTY/forwarding.
set -euo pipefail
umask 077
ROOT=/srv/wipster
read -r ACTION SOURCE IMAGE ARCHIVE OPS EXTRA <<< "${SSH_ORIGINAL_COMMAND:-}"
[[ $ACTION == deploy && -z ${EXTRA:-} && $SOURCE =~ ^[0-9a-f]{40}$ && $IMAGE =~ ^sha256:[0-9a-f]{64}$ && $ARCHIVE =~ ^[0-9a-f]{64}$ && $OPS =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid deploy request' >&2; exit 2; }
exec 9>"$ROOT/runtime/operation.lock"
flock -w 600 9
[[ -f $ROOT/config/rollout-enabled ]] || { echo 'Rollout gate is closed pending lead acceptance' >&2; exit 1; }
python3 "$ROOT/bin/validate_env.py" "$ROOT"
[[ $(cat "$ROOT/config/ops.sha256") == "$OPS" ]] || { echo 'Server ops differs from reviewed CI source' >&2; exit 1; }
[[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -gt 5242880 ]] || { echo 'Less than 5GiB free' >&2; exit 1; }
TMP=$(mktemp "$ROOT/runtime/image.XXXXXX.tar.gz")
trap 'rm -f "$TMP"' EXIT
# Stop at a bounded compressed size, including on an untrusted SSH connection.
timeout 300 head -c 536870913 > "$TMP"
[[ $(stat -c %s "$TMP") -le 536870912 ]] || { echo 'Archive exceeds 512MiB' >&2; exit 1; }
[[ $(sha256sum "$TMP" | cut -d' ' -f1) == "$ARCHIVE" ]] || { echo 'Archive checksum mismatch' >&2; exit 1; }
python3 "$ROOT/bin/verify_archive.py" "$TMP" "$SOURCE" "$IMAGE"
docker load -i "$TMP" > /dev/null
[[ $(docker image inspect "wipster-backend:$SOURCE" --format '{{.Id}}') == "$IMAGE" ]] || { echo 'Image identity mismatch' >&2; exit 1; }
[[ $(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$SOURCE" ]] || { echo 'Source label mismatch' >&2; exit 1; }
"$ROOT/bin/release.sh" deploy "$SOURCE" "$IMAGE" "$ARCHIVE"
