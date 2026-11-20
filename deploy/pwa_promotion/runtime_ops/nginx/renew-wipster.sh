#!/bin/sh
# Per-certificate hook only; does not change the existing global hook.
set -eu
/usr/sbin/nginx -t
/bin/systemctl reload nginx
