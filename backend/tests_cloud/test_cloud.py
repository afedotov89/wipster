import copy
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch
import pytest
from django.db import connection, close_old_connections
from django.test import Client, override_settings
from django.utils import timezone
from apps.accounts.models import Account, Challenge, DeviceSession, RateBucket
from apps.accounts.service import digest, start, verify, APIError
from apps.accounts.providers import Twilio, ProviderUnavailable
from apps.sync.models import Entity, Change, Receipt
from apps.sync.service import push
from apps.sync.validation import TASK_TEXT

pytestmark = pytest.mark.django_db


def post(c, path, body):
    return c.post('/api/v1/' + path, json.dumps(body), content_type='application/json')


def login(phone='+14155552671'):
    c = Client()
    r = post(c, 'auth/start', {'phone': phone})
    assert r.status_code == 200, r.content
    ch = Challenge.objects.get(pk=r.json()['challenge_id'])
    r = post(c, 'auth/verify', {'challenge_id': str(ch.id), 'code': ch.development_code, 'device_name': 'test'})
    assert r.status_code == 200, r.content
    token = r.json()['token']
    c.defaults['HTTP_AUTHORIZATION'] = 'Bearer ' + token
    return c, token, ch


def operation(kind, ident, data, version=0):
    return {'kind': kind, 'id': ident, 'data': data, 'base_version': version}


def task(ident, title='one', status='queue', project=None):
    d = dict.fromkeys(TASK_TEXT)
    d.update(id=ident, title=title, status=status, tags='[]', checklist='[]', position=0,
             project_id=project, created_at='1990-01-01', updated_at='2999-01-01')
    return d


def project(ident, parent=None):
    return dict(id=ident, name=ident, parent_id=parent, icon=None, icon_image=None, icon_mono=0,
                color=None, order=0, created_at='x', updated_at='x')


def batch(*ops, **extra):
    return {'batch_id': str(uuid.uuid4()), 'operations': list(ops), **extra}


def send(c, *ops, **extra):
    return post(c, 'sync/push', batch(*ops, **extra))


def pull(c, cursor=0, limit=200):
    return c.get(f'/api/v1/sync/pull?cursor={cursor}&limit={limit}')


def test_phone_login_replay_revocation_and_no_plain_token_storage():
    c, token, ch = login()
    assert not DeviceSession.objects.filter(pk=token).exists()
    assert DeviceSession.objects.filter(pk=digest(token)).exists()
    assert Challenge.objects.get(pk=ch.pk).development_code == ''
    assert post(Client(), 'auth/verify', {'challenge_id': str(ch.id), 'code': ch.development_code}).status_code == 400
    assert pull(c).status_code == 200
    assert post(c, 'auth/logout', {}).status_code == 200
    assert pull(c).status_code == 401
    assert send(c, operation('task', 'x', task('x'))).status_code == 401


def test_expiry_attempt_cap_and_invalid_inputs():
    assert post(Client(), 'auth/start', {'phone': '4155552671'}).status_code == 400
    assert post(Client(), 'auth/start', {'phone': '+10000000000'}).status_code == 400
    response = start('+14155552671', 'ip')
    ch = Challenge.objects.get(pk=response['challenge_id'])
    code = ch.development_code
    for _ in range(5):
        with pytest.raises(APIError): verify(ch.id, 'bad', 'ip', 'test')
    with pytest.raises(APIError): verify(ch.id, code, 'ip', 'test')
    assert not Account.objects.exists()
    ch.attempts = 0; ch.expires_at = timezone.now() - timedelta(seconds=1); ch.save()
    with pytest.raises(APIError): verify(ch.id, code, 'ip', 'test')
    for bad in ({'challenge_id': []}, {'challenge_id': 'not-uuid'}, {'challenge_id': None}):
        assert post(Client(), 'auth/verify', bad).status_code == 400


def test_durable_rate_limits_and_opaque_errors():
    c = Client()
    body = {'phone': '+14155552671'}
    assert post(c, 'auth/start', body).status_code == 200
    assert post(c, 'auth/start', body).status_code == 429
    assert RateBucket.objects.exists()
    assert b'code' not in post(c, 'auth/start', body).content


def test_sessions_and_accounts_are_isolated():
    first, _, _ = login()
    # Separate device login uses a separate phone challenge after cooldown buckets reset in this fixture.
    RateBucket.objects.all().delete()
    second, _, _ = login()
    other, _, _ = login('+442079460018')
    assert send(first, operation('task', 'same-id', task('same-id', 'private'))).status_code == 200
    assert pull(second).json()['changes'][0]['data']['title'] == 'private'
    assert pull(other).json()['changes'] == []
    assert send(other, operation('task', 'same-id', task('same-id', 'other'))).status_code == 200
    assert pull(first).json()['changes'][0]['data']['title'] == 'private'
    post(first, 'auth/logout', {})
    assert pull(second).status_code == 200


def test_two_clients_retry_conflict_delete_and_tombstone():
    a, _, _ = login()
    body = batch(operation('task', 't', task('t')))
    one = post(a, 'sync/push', body)
    assert one.status_code == 200
    assert post(a, 'sync/push', body).json() == one.json()
    assert Change.objects.count() == 1
    changed = copy.deepcopy(body); changed['operations'][0]['data']['title'] = 'different'
    assert post(a, 'sync/push', changed).status_code == 409
    assert send(a, operation('task', 't', task('t', 'device B'), 1)).status_code == 200
    stale = send(a, operation('task', 't', task('t', 'offline A'), 1))
    assert stale.status_code == 409
    assert stale.json()['conflicts'][0]['version'] == 2
    assert 'data' not in stale.json()['conflicts'][0]
    assert send(a, operation('task', 't', None, 2)).status_code == 200
    assert pull(a).json()['changes'][-1]['data'] is None
    assert send(a, operation('task', 't', task('t'))).status_code == 409
    assert Entity.objects.get(entity_id='t').version == 3


def test_immutable_feed_paging_and_interleaved_writes():
    c, _, _ = login()
    send(c, operation('task', 'a', task('a')), operation('task', 'b', task('b')))
    page = pull(c, limit=1).json()
    assert page['cursor'] == 1 and page['has_more']
    send(c, operation('task', 'a', task('a', 'new'), 1))
    second = pull(c, page['cursor'], 1).json()
    third = pull(c, second['cursor'], 1).json()
    assert [page['changes'][0]['data']['title'], third['changes'][0]['data']['title']] == ['one', 'new']
    assert [second['cursor'], third['cursor']] == [2, 3]
    assert not third['has_more']
    assert pull(c, 4).status_code == 400


def test_atomic_graphs_ownership_cycles_and_import_guard():
    c, _, _ = login()
    assert send(c, operation('task', 't', task('t', project='p')), operation('project', 'p', project('p'))).status_code == 200
    bad = send(c, operation('project', 'p', project('p', 'q'), 1), operation('project', 'q', project('q', 'p')))
    assert bad.status_code == 422
    assert not Entity.objects.filter(entity_id='q').exists()
    assert send(c, operation('project', 'p', None, 1)).status_code == 422
    assert send(c, operation('task', 'no', task('no', project='foreign'))).status_code == 422
    assert send(c, operation('task', 'new', task('new')), require_empty=True).status_code == 409
    assert send(c, operation('task', 't', None, 1), operation('project', 'p', None, 1)).status_code == 200


def test_wip_final_state_atomic_swap_and_settings_allowlist():
    c, _, _ = login()
    limit = operation('preference', 'wip_limit', {'key': 'wip_limit', 'value': '1'})
    assert send(c, limit, operation('task', 'a', task('a', status='doing')), operation('task', 'b', task('b'))).status_code == 200
    assert send(c, operation('task', 'b', task('b', status='doing'), 1)).status_code == 422
    assert Entity.objects.get(entity_id='b').data['status'] == 'queue'
    assert send(c, operation('task', 'a', task('a'), 1), operation('task', 'b', task('b', status='doing'), 1)).status_code == 200
    assert send(c, operation('preference', 'llm_api_key', {'key': 'llm_api_key', 'value': 'never'})).status_code == 422


def test_no_cookie_auth_schema_injection_and_readiness():
    c = Client()
    assert pull(c).status_code == 401
    assert c.get('/healthz').status_code == 200
    assert c.get('/readyz').status_code == 200
    c, token, _ = login()
    assert send(c, operation('task', 'x', {'unexpected': 'payload'})).status_code == 422
    assert post(c, 'sync/push', {'batch_id': str(uuid.uuid4()), 'operations': [{'kind': [], 'id': 'x'}]}).status_code == 400
    session = DeviceSession.objects.get(pk=digest(token)); session.expires_at = timezone.now() - timedelta(seconds=1); session.save()
    assert pull(c).status_code == 401


def test_twilio_safe_errors_and_timeouts():
    ch = Challenge(phone='+14155552671', provider='twilio', expires_at=timezone.now(), provider_id='VEtest')
    with patch('apps.accounts.providers.requests.post') as call:
        call.return_value.status_code = 200
        call.return_value.json.return_value = {'status': 'approved'}
        assert Twilio().check(ch, '123456')
        assert call.call_args.kwargs['timeout'] == (3, 7)
        assert not call.call_args.kwargs['allow_redirects']
        call.return_value.status_code = 500
        with pytest.raises(ProviderUnavailable): Twilio().check(ch, '123456')


@pytest.mark.django_db(transaction=True)
def test_postgres_wip_race_and_commit_order():
    if connection.vendor != 'postgresql': pytest.skip('PostgreSQL row locks required')
    c, token, _ = login()
    assert send(c, operation('preference', 'wip_limit', {'key': 'wip_limit', 'value': '1'})).status_code == 200
    def race(ident):
        close_old_connections()
        try:
            session = DeviceSession.objects.get(pk=digest(token))
            try:
                push(session, batch(operation('task', ident, task(ident, status='doing'))))
                return 200
            except APIError as e:
                return e.status
        finally: close_old_connections()
    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(race, ['a', 'b'])) == [200, 422]
    assert Change.objects.count() == 2
    assert list(Change.objects.values_list('sequence', flat=True)) == [1, 2]


def field(ident, kind='text'):
    return dict(id=ident, key=ident, label='Custom', kind=kind, options='[]', builtin=0, enabled=1,
                position=10, removed_at=None, created_at='x', column_side=None)


def test_custom_fields_values_and_local_path_rejection():
    c, _, _ = login()
    f = field('f')
    value = {'task_id': 't', 'field_id': 'f', 'value': '"meaningful"', 'updated_at': 'x'}
    assert send(c, operation('value', 't:f', value), operation('field', 'f', f), operation('task', 't', task('t'))).status_code == 200
    assert send(c, operation('value', 't:f', dict(value, field_id='other'), 1)).status_code == 422
    removed = dict(f, enabled=0, removed_at='x')
    assert send(c, operation('field', 'f', removed, 1)).status_code == 200
    assert Entity.objects.get(kind='value').data['value'] == '"meaningful"'
    assert send(c, operation('field', 'f', dict(removed, kind='number'), 2)).status_code == 422
    assert send(c, operation('field', 'files', field('files', 'file_list')),
                operation('value', 't:files', dict(value, field_id='files', value='["/private/file"]'))).status_code == 422
    assert send(c, operation('task', 't', dict(task('t'), return_ref='captured private context'), 1)).status_code == 422


@pytest.mark.django_db(transaction=True)
def test_postgres_otp_consumption_race():
    if connection.vendor != 'postgresql': pytest.skip('PostgreSQL row locks required')
    ch = Challenge.objects.get(pk=start('+14155552671', 'ip')['challenge_id'])
    def race(_):
        close_old_connections()
        try:
            try:
                verify(ch.id, ch.development_code, 'ip', 'device')
                return 200
            except APIError as e:
                return e.status
        finally: close_old_connections()
    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(race, range(2))) == [200, 400]
    assert DeviceSession.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_postgres_feed_waits_for_commit_and_never_skips_later_writes():
    if connection.vendor != 'postgresql': pytest.skip('PostgreSQL row locks required')
    from threading import Event
    from django.db import transaction
    from apps.sync.service import pull as feed
    c, token, _ = login()
    session = DeviceSession.objects.get(pk=digest(token))
    locked, release, second_started = Event(), Event(), Event()
    def first():
        close_old_connections()
        try:
            with transaction.atomic():
                Account.objects.select_for_update().get(pk=session.account_id)
                push(session, batch(operation('task', 'a', task('a'))))
                locked.set()
                assert release.wait(5)
        finally: close_old_connections()
    def second():
        close_old_connections()
        try:
            second_started.set()
            push(session, batch(operation('task', 'b', task('b'))))
        finally: close_old_connections()
    with ThreadPoolExecutor(2) as pool:
        a = pool.submit(first); assert locked.wait(5)
        b = pool.submit(second); assert second_started.wait(5)
        release.set(); a.result(); b.result()
    one = feed(session, 0, 1); two = feed(session, one['cursor'], 1)
    assert [one['changes'][0]['id'], two['changes'][0]['id']] == ['a', 'b']
    assert [one['cursor'], two['cursor']] == [1, 2]


def test_revoked_session_cannot_pass_the_transactional_write_check():
    c, token, _ = login()
    stale_session = DeviceSession.objects.get(pk=digest(token))
    post(c, 'auth/logout', {})
    with pytest.raises(APIError) as failure:
        push(stale_session, batch(operation('task', 't', task('t'))))
    assert failure.value.status == 401
    assert not Entity.objects.exists()


def test_unsafe_production_settings_fail_at_startup():
    import os
    import subprocess
    import sys
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    base = {'PATH': os.environ.get('PATH', ''), 'DEBUG': 'false', 'SECRET_KEY': 'x' * 64,
            'DATABASE_URL': 'postgresql://placeholder@127.0.0.1/wipster', 'ALLOWED_HOSTS': 'sync.example.com',
            'OTP_PROVIDER': 'twilio', 'TWILIO_ACCOUNT_SID': 'placeholder', 'TWILIO_AUTH_TOKEN': 'placeholder',
            'TWILIO_VERIFY_SERVICE_SID': 'placeholder'}
    for change in ({'SECRET_KEY': 'development-only'}, {'DATABASE_URL': 'sqlite:///:memory:'},
                   {'OTP_PROVIDER': 'development', 'DEV_OTP_ENABLED': 'true'}, {'ALLOWED_HOSTS': '*'},
                   {'TWILIO_AUTH_TOKEN': ''}):
        r = subprocess.run([sys.executable, 'manage.py', 'check'], cwd=root, env={**base, **change}, capture_output=True)
        assert r.returncode != 0
    assert subprocess.run([sys.executable, 'manage.py', 'check'], cwd=root, env=base, capture_output=True).returncode == 0


def test_tombstones_cannot_target_device_credentials_or_local_files():
    c, _, _ = login()
    assert send(c, operation('preference', 'llm_api_key', None)).status_code == 422
    assert send(c, operation('field', 'files', field('files', 'file_list'))).status_code == 200
    assert send(c, operation('value', 't:files', None)).status_code == 422
    assert send(c, operation('field', 'reserved', dict(field('reserved'), key='priority'))).status_code == 422
    assert send(c, operation('project', 'colon:id', project('colon:id'))).status_code == 422
    assert send(c, operation('task', 'x', task('x'), 0), operation('task', 'x', None, 0)).status_code == 400


def test_resend_invalidates_earlier_challenge_even_with_the_correct_code():
    old = Challenge.objects.get(pk=start('+14155552671', 'ip')['challenge_id'])
    old_code = old.development_code
    RateBucket.objects.all().delete()  # advance beyond cooldown for this test without a real wait
    new = Challenge.objects.get(pk=start('+14155552671', 'ip')['challenge_id'])
    with pytest.raises(APIError): verify(old.id, old_code, 'ip', 'old')
    assert verify(new.id, new.development_code, 'ip', 'new')['account_id']
    assert DeviceSession.objects.count() == 1


def test_unicode_batch_has_compact_retryable_ack_and_bounded_conflict_metadata():
    from apps.sync.encoding import encoded
    c, _, _ = login()
    ops = [operation('task', f'unicode-{i}', dict(task(f'unicode-{i}'), comment='я' * 50000)) for i in range(60)]
    body = batch(*ops)
    payload = encoded(body)
    assert len(payload) < 7 * 1024 * 1024
    response = c.post('/api/v1/sync/push', payload, content_type='application/json')
    assert response.status_code == 200
    assert len(response.content) < 30000
    assert response.json()['batch_id'] == body['batch_id']
    assert all(set(ch) == {'kind', 'id', 'version'} for ch in response.json()['changes'])
    assert c.post('/api/v1/sync/push', payload, content_type='application/json').content == response.content
    assert Change.objects.count() == 60
    # A receipt from the previous full-payload contract is projected on read,
    # without rewriting/pruning the receipt or reapplying the committed batch.
    receipt = Receipt.objects.get(batch_id=body['batch_id'])
    receipt.response = {'changes': [dict(ch, data=ops[i]['data']) for i, ch in enumerate(response.json()['changes'])]}
    receipt.save()
    assert c.post('/api/v1/sync/push', payload, content_type='application/json').content == response.content
    assert Change.objects.count() == 60
    stale = batch(*ops)
    conflict = c.post('/api/v1/sync/push', encoded(stale), content_type='application/json')
    assert conflict.status_code == 409 and len(conflict.content) < 30000
    assert all(set(ch) == {'kind', 'id', 'version'} for ch in conflict.json()['conflicts'])


def test_large_valid_multibatch_feed_pages_by_utf8_bytes_without_cursor_holes():
    from apps.sync.encoding import MAX_PAGE_BYTES, encoded
    c, _, _ = login()
    for start_at in range(0, 180, 60):
        ops = [operation('task', f'large-{i}', dict(task(f'large-{i}'), comment='x' * 100000)) for i in range(start_at, start_at + 60)]
        response = c.post('/api/v1/sync/push', encoded(batch(*ops)), content_type='application/json')
        assert response.status_code == 200
    seen, cursor, pages = [], 0, 0
    while True:
        response = pull(c, cursor, 200)
        assert response.status_code == 200
        assert len(response.content) <= MAX_PAGE_BYTES < 16 * 1024 * 1024
        page = response.json()
        assert page['cursor'] > cursor
        seen.extend(ch['sequence'] for ch in page['changes'])
        cursor = page['cursor']; pages += 1
        if pages == 1:
            assert page['has_more'] and len(page['changes']) < 180
            assert send(c, operation('task', 'concurrent', task('concurrent'))).status_code == 200
        if not page['has_more']: break
    assert seen == list(range(1, 182)) and pages >= 2


def test_byte_paging_counts_actual_unicode_encoding_and_preserves_single_entity_progress():
    from apps.sync.encoding import encoded
    c, _, _ = login()
    body = batch(*[operation('task', f't{i}', dict(task(f't{i}'), comment='я' * 50000)) for i in range(4)])
    assert c.post('/api/v1/sync/push', encoded(body), content_type='application/json').status_code == 200
    with patch('apps.sync.encoding.MAX_PAGE_BYTES', 210000):
        one = pull(c).json(); two = pull(c, one['cursor']).json()
        assert [ch['id'] for ch in one['changes']] == ['t0', 't1']
        assert [ch['id'] for ch in two['changes']] == ['t2', 't3']
        assert one['has_more'] and not two['has_more']
        assert len(encoded(one)) <= 210000 and len(encoded(two)) <= 210000
    with patch('apps.sync.encoding.MAX_PAGE_BYTES', 10):
        assert pull(c).status_code == 422  # Never return an empty page with has_more=true.
