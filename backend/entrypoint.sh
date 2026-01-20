#!/bin/bash
set -e

echo "Waiting for database to be ready..."

echo "Running database migrations..."
python manage.py migrate --noinput

echo "Starting application server..."
exec "$@" 