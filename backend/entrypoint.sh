#!/bin/sh
set -eu
# Production runs migrations as a single release job, never in every API replica.
if [ "${DEBUG:-false}" = "true" ]; then
    python manage.py migrate --noinput
fi
exec "$@"
