#!/usr/bin/env python3
"""Atomic PWA additive migrations with defaults needed by the retained old app.

Executed through stdin inside the candidate image by the existing locked release
path. No provider call, cleanup or data rewrite. The old image can still INSERT
native sessions/attempts after an application-only rollback.
"""
import os


def ensure_legacy_defaults(connection):
    with connection.cursor() as cursor:
        cursor.execute("ALTER TABLE accounts_devicesession ALTER COLUMN channel SET DEFAULT 'native'")
        cursor.execute("ALTER TABLE accounts_yandexattempt ALTER COLUMN channel SET DEFAULT 'native'")


def migrate():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'project.settings')
    import django
    django.setup()
    from django.core.management import call_command
    from django.db import connection, transaction
    if connection.vendor != 'postgresql':
        raise RuntimeError('PostgreSQL is required for atomic compatible PWA migration')
    # One outer transaction removes the gap between Django's temporary defaults
    # and the persistent defaults. Older ORM writes wait on the schema lock and
    # then succeed, rather than seeing a NOT NULL column with no DB default.
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL lock_timeout = '5s'")
            cursor.execute("SET LOCAL statement_timeout = '60s'")
        call_command('migrate', interactive=False, verbosity=1)
        ensure_legacy_defaults(connection)


if __name__ == '__main__':
    migrate()
