"""Runs unchanged old/new Django code against synthetic isolated PostgreSQL only."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
import uuid
from datetime import timedelta
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'project.settings')
sys.path.insert(0, os.environ['COMPAT_BACKEND'])
import django
django.setup()
from django.db import connection, transaction, IntegrityError
from django.utils import timezone
from apps.accounts.models import Account, DeviceSession, YandexAttempt, ExternalIdentity
from apps.accounts import service, yandex
from apps.sync import service as sync
from django.test import RequestFactory
mode = sys.argv[1]
statepath = Path(os.environ['COMPAT_STATE'])
def authenticate(token):
    return service.authenticate(RequestFactory().get('/', HTTP_AUTHORIZATION='Bearer '+token))
def project_data(name):
    return dict(id='retained-project', name=name, parent_id=None, icon=None, icon_image=None,
                icon_mono=0, color=None, order=0, created_at='x', updated_at='x')
def write(session, name, version):
    result = sync.push(session, {'batch_id': str(uuid.uuid4()), 'operations': [
        dict(kind='project', id='retained-project', base_version=version, data=project_data(name))]})
    assert not result.get('conflicts'), result
    return sync.pull(session, 0, 200)
def attempt():
    return yandex.start({'device_name':'synthetic-old-login'}, '127.0.0.1')
if mode == 'seed':
    a = Account.objects.create()
    ExternalIdentity.objects.create(account=a, issuer=yandex.ISSUER, subject='synthetic-retained')
    login = service.issue_session(a, 'retained-before-migration')
    flow = attempt()
    YandexAttempt.objects.filter(pk=flow['attempt_id']).update(status='ready', subject='synthetic-retained')
    write(authenticate(login['token']), 'latest-before-migration', 0)
    statepath.write_text(json.dumps(dict(account=str(a.pk), token=login['token'], flow=flow)))
elif mode == 'old-inserts-fail':
    a = Account.objects.first()
    for model, action in [(DeviceSession, lambda: service.issue_session(a, 'old')),
                          (YandexAttempt, attempt)]:
        try:
            with transaction.atomic(): action()
        except IntegrityError as exc:
            assert exc.__cause__.sqlstate == '23502', str(exc)
            assert exc.__cause__.diag.column_name == 'channel', str(exc)
            assert exc.__cause__.diag.table_name == model._meta.db_table, str(exc)
        else: raise AssertionError('old INSERT unexpectedly passed')
elif mode in ('old-semantics', 'overlap-write'):
    state = json.loads(statepath.read_text())
    if mode == 'overlap-write':
        service.issue_session(Account.objects.get(pk=state['account']), 'INSERT-overlapping-DDL')
    live = authenticate(state['token'])
    assert str(live.account_id) == state['account']
    feed = sync.pull(live, 0, 200)
    assert feed['changes'][-1]['data']['name'] == 'latest-before-migration', feed
    # Reuse durable Yandex login created before schema change; no provider/network.
    login = yandex.finish(state['flow'], '127.0.0.1')
    assert login['account_id'] == state['account']
    assert yandex.finish(state['flow'], '127.0.0.1')['token'] == login['token']
    assert authenticate(login['token']).account_id == live.account_id
    latest = feed['changes'][-1]['version']
    assert write(live, 'written-after-rollback', latest)['changes'][-1]['data']['name'] == 'written-after-rollback'
    service.issue_session(live.account, 'new-old-native-write')
    attempt()
    assert Account.objects.count() == 1 and ExternalIdentity.objects.count() == 1
elif mode == 'new-channels':
    from apps.accounts.models import WebBrowser
    a = Account.objects.first()
    native = service.issue_session(a, 'native')
    web = service.issue_session(a, 'web', channel='web')
    assert DeviceSession.objects.get(pk=service.digest(native['token'])).channel == 'native'
    assert DeviceSession.objects.get(pk=service.digest(web['token'])).channel == 'web'
    try: authenticate(web['token'])
    except service.APIError as e: assert e.code == 'unauthorized'
    else: raise AssertionError('web token admitted to native API')
    for channel in ('native', 'web'):
        f = yandex.start({'device_name':'new-'+channel}, '127.0.0.1', channel=channel)
        assert YandexAttempt.objects.get(pk=f['attempt_id']).channel == channel
    WebBrowser.objects.create(credential_hash='a'*64, device_id=service.digest(web['token']),
                              expires_at=timezone.now()+timedelta(days=1))
elif mode.startswith('helper'):
    spec = importlib.util.spec_from_file_location('compat_helper', os.environ['COMPAT_HELPER'])
    h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
    original = h.ensure_legacy_defaults
    if mode == 'helper-failure':
        def fail(c):
            original(c)
            raise RuntimeError('synthetic-after-defaults-failure')
        h.ensure_legacy_defaults = fail
    elif mode == 'helper-statement-timeout':
        def slow(c):
            original(c)
            with c.cursor() as cur: cur.execute('SELECT pg_sleep(61)')
        h.ensure_legacy_defaults = slow
    elif mode == 'helper-overlap':
        def pause(c):
            Path(os.environ['COMPAT_PAUSED']).write_text('migrations finished, defaults pending')
            deadline = time.monotonic()+30
            while not Path(os.environ['COMPAT_RELEASE']).exists():
                if time.monotonic() > deadline: raise TimeoutError('test handoff')
                time.sleep(.05)
            original(c)
        h.ensure_legacy_defaults = pause
    h.migrate()
else: raise AssertionError(mode)
print(json.dumps({'mode':mode,'result':'PASS'}))
