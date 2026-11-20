#!/usr/bin/env bash
# Administrative, one-time Wipster-only ingress. CI never gets sudo.
set -euo pipefail
ROOT=/srv/wipster
SOURCE=${1:?reviewed deploy/msf source directory}
MODE=${2:?http or tls}
[[ $(hostname -s) == msf && $(id -un) == fedotov ]] || exit 2
[[ -f $ROOT/config/rollout-enabled ]] || { echo 'Lead acceptance gate is closed' >&2; exit 1; }
exec 9>"$ROOT/runtime/operation.lock"
flock -w 600 9
case "$MODE" in
    http) INPUT="$SOURCE/nginx/wipster.http.conf" ;;
    tls)
        INPUT="$SOURCE/nginx/wipster.conf"
        sudo -n openssl x509 -in /etc/letsencrypt/live/wipster.fedotovs.net/fullchain.pem -noout -checkhost wipster.fedotovs.net
        sudo -n openssl x509 -in /etc/letsencrypt/live/wipster.fedotovs.net/fullchain.pem -noout -checkend 604800
        ;;
    *) exit 2 ;;
esac
STAMP=$(date -u +%Y%m%dT%H%M%SZ)-$$
RECORD="$ROOT/runtime/ingress-$STAMP"
mkdir -m 700 "$RECORD"
snapshot() {
    sudo -n nginx -t 2>&1
    docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}'
    for domain in cartoons.fedotovs.net gitlab.fedotovs.net prism.fedotovs.net deepseek.fedotovs.net plmbots.ru; do
        curl --noproxy '*' --resolve "$domain:443:127.0.0.1" -sS --max-time 8 -o /dev/null -w "$domain %{http_code}\n" "https://$domain/"
    done
}
snapshot > "$RECORD/before.txt"
AVAILABLE=/etc/nginx/sites-available/wipster
ENABLED=/etc/nginx/sites-enabled/wipster
if [[ -L $ENABLED ]]; then
    [[ $(readlink "$ENABLED") == "$AVAILABLE" ]] || { echo 'Unexpected existing Wipster vhost ownership' >&2; exit 1; }
elif [[ -e $ENABLED ]]; then
    echo 'Unexpected Wipster ingress file; inspect before proceeding' >&2; exit 1
fi
EXISTING=0
if sudo -n test -f "$AVAILABLE"; then
    cat "$AVAILABLE" > "$RECORD/previous.conf"
    EXISTING=1
fi
sudo -n install -d -m 755 /var/www/wipster-acme
sudo -n install -o root -g root -m 644 "$INPUT" "$AVAILABLE.next"
sudo -n mv "$AVAILABLE.next" "$AVAILABLE"
sudo -n ln -sfn "$AVAILABLE" "$ENABLED"
if ! sudo -n nginx -t; then
    if [[ $EXISTING == 1 ]]; then
        sudo -n install -o root -g root -m 644 "$RECORD/previous.conf" "$AVAILABLE"
    else
        sudo -n unlink "$ENABLED"
        sudo -n unlink "$AVAILABLE"
    fi
    sudo -n nginx -t
    echo 'Wipster candidate rejected; disk configuration restored; nginx was not reloaded' >&2
    exit 1
fi
sudo -n systemctl reload nginx
snapshot > "$RECORD/after.txt"
echo "Wipster $MODE ingress validated and gracefully reloaded; evidence: $RECORD"
