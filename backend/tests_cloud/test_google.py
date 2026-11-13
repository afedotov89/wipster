import base64
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch, Mock
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest
import requests
from cryptography.hazmat.primitives.asymmetric import rsa
from django.db import close_old_connections, connection
from django.test import Client, override_settings
from django.utils import timezone

from apps.accounts import google
from apps.accounts.models import Account, DeviceSession, ExternalIdentity, GoogleAttempt, RateBucket
from apps.accounts.service import APIError, digest, issue_session
from apps.sync.models import Entity, Change, Receipt
from tests_cloud.test_cloud import post, pull, send, operation, task

pytestmark = pytest.mark.django_db
CLIENT = 'test-desktop.apps.googleusercontent.com'
VERIFIER = 'v' * 64


@pytest.fixture(autouse=True)
def configured():
    with override_settings(GOOGLE_ENABLED=True, GOOGLE_CLIENT_ID=CLIENT, GOOGLE_CLIENT_SECRET='', OTP_PROVIDER='disabled'):
        yield


def begin(client=None, link=False):
    client = client or Client()
    response = post(client, 'auth/google/' + ('link/' if link else '') + 'start',
                    {'redirect_uri': 'http://127.0.0.1:49152/', 'code_challenge': google.pkce(VERIFIER)})
    assert response.status_code == 200, response.content
    data = response.json()
    return client, data, dict(attempt_id=data['attempt_id'], proof=data['proof'], state=data['state'],
                             code_verifier=VERIFIER, code='opaque-code', device_name='independent test device')


def claims(subject='google-subject', **extra):
    return dict(sub=subject, email='person@example.com', email_verified=True, **extra)


def complete(client, body, identity=None, link=False):
    with patch('apps.accounts.google.exchange', return_value=identity or claims()):
        return post(client, 'auth/google/' + ('link/' if link else '') + 'finish', body)


def signin(subject='google-subject'):
    client, _, body = begin()
    result = complete(client, body, claims(subject))
    assert result.status_code == 200, result.content
    client.defaults['HTTP_AUTHORIZATION'] = 'Bearer ' + result.json()['token']
    return client, result.json()


def test_contract_capabilities_pkce_nonce_and_no_frontend_secret():
    client, data, body = begin()
    assert client.get('/api/v1/auth/capabilities').json() == {'yandex':False,'google': True, 'sms': False}
    assert post(client, 'auth/start', {'phone': '+14155552671'}).json()['error'] == 'sms_disabled'
    attempt = GoogleAttempt.objects.get(pk=data['attempt_id'])
    assert attempt.proof_hash == digest(data['proof']) and attempt.proof_hash != data['proof']
    url = urlsplit(data['authorization_url']); params = parse_qs(url.query)
    assert url.scheme == 'https' and url.hostname == 'accounts.google.com'
    assert params['scope'] == ['openid email'] and params['code_challenge_method'] == ['S256']
    assert params['nonce'] == [attempt.nonce] and params['state'] == [attempt.state]
    assert 'client_secret' not in params and 'token' not in data
    r = complete(client, body)
    assert r.status_code == 200 and r.json()['phone'] is None
    assert r['Cache-Control'] == 'no-store'
    assert DeviceSession.objects.filter(pk=digest(r.json()['token'])).exists()


@pytest.mark.parametrize('change', [dict(proof='wrong'), dict(state='wrong'), dict(code_verifier='x' * 64),
                                   dict(code_verifier=[]), dict(code=[]), dict(attempt_id=[]), dict(proof=[]), dict(state=[]), dict(state='ü'*43)])
def test_invalid_proof_state_verifier_are_rejected_before_network(change):
    client, _, body = begin()
    with patch('apps.accounts.google.exchange') as exchange:
        response = post(client, 'auth/google/finish', {**body, **change})
    assert response.status_code == 400
    exchange.assert_not_called()
    assert not Account.objects.exists()


@pytest.mark.parametrize('redirect', ['http://localhost:1234/', 'http://127.0.0.1:80/evil', 'http://127.0.0.1:80/?x=y',
                                     'https://evil.test/', 'http://u:p@127.0.0.1:80/', 'http://127.0.0.1:99999/', [], None])
def test_redirect_is_exact_loopback_only(redirect):
    assert post(Client(), 'auth/google/start', {'redirect_uri': redirect, 'code_challenge': 'a'*43}).status_code == 400


def test_expiry_cancel_and_replay_require_fresh_attempt():
    client, data, body = begin()
    attempt = GoogleAttempt.objects.get(pk=data['attempt_id'])
    attempt.expires_at = timezone.now() - timedelta(seconds=1); attempt.save()
    assert complete(client, body).status_code == 400
    client, _, body = begin()
    assert post(client, 'auth/google/cancel', body).status_code == 200
    assert complete(client, body).status_code == 400
    client, _, body = begin()
    assert complete(client, body).status_code == 200
    assert complete(client, body).status_code == 400
    assert DeviceSession.objects.count() == 1


def test_provider_failure_consumes_once_and_errors_are_opaque():
    client, _, body = begin()
    with patch('apps.accounts.google.exchange', side_effect=APIError('google_unavailable', 503)):
        response = post(client, 'auth/google/finish', body)
    assert response.status_code == 503
    assert response.json() == {'error': 'google_unavailable'}
    assert complete(client, body).status_code == 400
    assert not Account.objects.exists()


def test_two_devices_same_subject_independent_sessions_and_isolation_no_email_merge():
    a, first = signin()
    b, second = signin()
    other, third = signin('different-sub-same-email')
    assert first['account_id'] == second['account_id'] != third['account_id']
    assert first['token'] != second['token']
    assert send(a, operation('task', 'private', task('private'))).status_code == 200
    assert len(pull(b).json()['changes']) == 1 and pull(other).json()['changes'] == []
    assert post(a, 'auth/logout', {}).status_code == 200
    assert pull(a).status_code == 401 and pull(b).status_code == 200
    assert Account.objects.count() == 2


def test_explicit_link_retains_phone_account_data_and_rejects_collisions():
    original = Account.objects.create(phone='+14155552671')
    session = issue_session(original, 'existing phone session')
    client = Client(HTTP_AUTHORIZATION='Bearer ' + session['token'])
    assert send(client, operation('task', 'old', task('old'))).status_code == 200
    _, _, body = begin(client, link=True)
    assert complete(client, body, link=True).status_code == 200
    google_client, result = signin()
    assert result['account_id'] == str(original.pk)
    assert result['phone'] == original.phone
    assert pull(google_client).json()['changes'][0]['id'] == 'old'
    assert DeviceSession.objects.filter(pk=digest(session['token']), revoked_at__isnull=True).exists()
    other = Account.objects.create(phone='+442079460018')
    token = issue_session(other, 'other')['token']
    other_client = Client(HTTP_AUTHORIZATION='Bearer ' + token)
    _, _, other_body = begin(other_client, link=True)
    collision = complete(other_client, other_body, link=True)
    assert collision.status_code == 409 and collision.json()['error'] == 'google_identity_in_use'
    assert ExternalIdentity.objects.get(subject='google-subject').account_id == original.pk
    assert pull(other_client).json()['changes'] == []


def test_link_cannot_be_swapped_between_sessions_or_login_and_revocation_wins():
    account = Account.objects.create(phone='+14155552671')
    first = Client(HTTP_AUTHORIZATION='Bearer ' + issue_session(account, 'one')['token'])
    second = Client(HTTP_AUTHORIZATION='Bearer ' + issue_session(account, 'two')['token'])
    _, _, body = begin(first, link=True)
    assert complete(second, body, link=True).status_code == 400
    assert complete(Client(), body).status_code == 400
    assert post(Client(), 'auth/google/link/start', {}).status_code == 401
    post(first, 'auth/logout', {})
    assert complete(first, body, link=True).status_code == 401
    assert not ExternalIdentity.objects.exists()


def test_cancel_or_revoke_during_exchange_prevents_completion():
    client, data, body = begin()
    def cancelling(*args):
        google.cancel(body, 'ip')
        return claims()
    with patch('apps.accounts.google.exchange', side_effect=cancelling):
        assert post(client, 'auth/google/finish', body).status_code == 400
    assert not Account.objects.exists()
    account = Account.objects.create()
    token = issue_session(account, 'phone')['token']
    client = Client(HTTP_AUTHORIZATION='Bearer ' + token)
    _, _, body = begin(client, link=True)
    def revoking(*args):
        DeviceSession.objects.filter(pk=digest(token)).update(revoked_at=timezone.now())
        return claims()
    with patch('apps.accounts.google.exchange', side_effect=revoking):
        assert post(client, 'auth/google/link/finish', body).status_code == 401
    assert not ExternalIdentity.objects.exists()


@pytest.fixture(scope='module')
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def signed(signing_key, nonce='expected', **changes):
    now = int(timezone.now().timestamp())
    payload = dict(iss=google.ISSUER, aud=CLIENT, sub='stable-sub', iat=now, exp=now+300, nonce=nonce)
    payload.update(changes)
    return jwt.encode(payload, signing_key, algorithm='RS256', headers={'kid': 'test-key'})


@pytest.mark.parametrize('changes', [dict(iss='https://evil.test'), dict(aud='wrong-client'), dict(exp=1),
                                    dict(nonce='wrong'), dict(sub=''), dict(iat=9999999999), dict(azp='evil'),
                                    dict(aud=[CLIENT, 'evil']), dict(nonce=None)])
def test_id_token_rejects_untrusted_claims(signing_key, changes):
    with patch('apps.accounts.google.keys') as keys:
        keys.return_value.get_signing_key_from_jwt.return_value.key = signing_key.public_key()
        with pytest.raises(APIError) as err:
            google.verify_id_token(signed(signing_key, **changes), 'expected')
        assert err.value.code == 'invalid_google_login'


def test_id_token_signature_algorithm_required_nonce_and_canonical_issuer(signing_key):
    wrong = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with patch('apps.accounts.google.keys') as keys:
        keys.return_value.get_signing_key_from_jwt.return_value.key = signing_key.public_key()
        assert google.verify_id_token(signed(signing_key), 'expected')['sub'] == 'stable-sub'
        assert google.verify_id_token(signed(signing_key, iss='accounts.google.com'), 'expected')['sub'] == 'stable-sub'
        for token in [signed(wrong), jwt.encode({'nonce':'expected'}, 's' * 32, algorithm='HS256'),
                      jwt.encode({'iss':google.ISSUER,'aud':CLIENT,'sub':'s','iat':1,'exp':9999999999}, signing_key, algorithm='RS256')]:
            with pytest.raises(APIError): google.verify_id_token(token, 'expected')


def response_json(data, status=200):
    response = Mock(status_code=status)
    response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=None)
    response.iter_content.return_value = [json.dumps(data).encode()]
    return response


def test_real_library_jwks_cache_rotation_and_fixed_bounded_network(signing_key):
    def jwk(key, kid):
        return {**json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key())), 'kid':kid, 'use':'sig', 'alg':'RS256'}
    rotated = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    client = google.GoogleKeys(google.JWKS_URL, cache_keys=False, lifespan=300)
    with patch('apps.accounts.google.requests.get') as get, patch('apps.accounts.google.keys', return_value=client):
        get.return_value = response_json({'keys':[jwk(signing_key,'test-key')]})
        google.verify_id_token(signed(signing_key), 'expected')
        google.verify_id_token(signed(signing_key), 'expected')
        assert get.call_count == 1
        get.return_value = response_json({'keys':[jwk(rotated,'rotated')]})
        token = jwt.encode(jwt.decode(signed(signing_key), signing_key.public_key(), algorithms=['RS256'], audience=CLIENT),
                           rotated, algorithm='RS256', headers={'kid':'rotated'})
        google.verify_id_token(token, 'expected')
        assert get.call_count == 2
        assert get.call_args.args == (google.JWKS_URL,)
        assert get.call_args.kwargs == dict(timeout=(3,5), allow_redirects=False, stream=True)


def test_token_exchange_is_bounded_no_refresh_credentials_and_failures(signing_key):
    with patch('apps.accounts.google.requests.post') as post_call, patch('apps.accounts.google.verify_id_token', return_value=claims()) as verify:
        post_call.return_value = response_json(dict(id_token='signed-id', access_token='discard', refresh_token='discard'))
        result = google.exchange('code', VERIFIER, 'http://127.0.0.1:1234/', 'nonce')
        assert result == claims()
        verify.assert_called_once_with('signed-id', 'nonce')
        assert post_call.call_args.kwargs['timeout'] == (3,7)
        assert post_call.call_args.kwargs['allow_redirects'] is False
        assert post_call.call_args.kwargs['data']['code_verifier'] == VERIFIER
        post_call.side_effect = requests.Timeout('sensitive response must never appear')
        with pytest.raises(APIError) as err: google.exchange('code', VERIFIER, 'redirect', 'nonce')
        assert err.value.code == 'google_unavailable'


def test_disabled_providers_and_durable_quota():
    with override_settings(GOOGLE_ENABLED=False):
        assert Client().get('/api/v1/auth/capabilities').json() == {'yandex':False,'google':False,'sms':False}
        assert post(Client(), 'auth/google/start', {}).status_code == 404
        assert post(Client(), 'auth/google/finish', {}).status_code == 404
    for _ in range(20): begin()
    assert post(Client(), 'auth/google/start', {}).status_code == 429
    assert RateBucket.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_postgres_single_attempt_concurrent_consumption_and_same_subject_creation():
    if connection.vendor != 'postgresql': pytest.skip('PostgreSQL locks required')
    _, _, body = begin()
    def finish(body):
        close_old_connections()
        try:
            try: return google.finish(body, 'race-ip')
            except APIError as err: return err.status
        finally: close_old_connections()
    with patch('apps.accounts.google.exchange', return_value=claims()) as exchange:
        with ThreadPoolExecutor(2) as pool: results = list(pool.map(finish, [body, body]))
        assert sum(isinstance(x, dict) for x in results) == 1 and 400 in results
        assert exchange.call_count == 1
    # Two fresh attempts may exchange concurrently, but identity uniqueness must resolve one account.
    Account.objects.all().delete()
    _, _, first = begin(); _, _, second = begin()
    from threading import Barrier
    barrier = Barrier(2)
    def exchange(*args):
        barrier.wait(timeout=5)
        return claims()
    with patch('apps.accounts.google.exchange', side_effect=exchange):
        with ThreadPoolExecutor(2) as pool: results = list(pool.map(finish, [first, second]))
    assert len({r['account_id'] for r in results}) == 1
    assert Account.objects.count() == ExternalIdentity.objects.count() == 1
    assert DeviceSession.objects.count() == 2


@pytest.mark.django_db(transaction=True)
def test_existing_phone_migration_preserves_uuid_sessions_entities_and_receipts():
    from django.db.migrations.executor import MigrationExecutor
    executor = MigrationExecutor(connection)
    before = [('accounts','0003_alter_challenge_expires_at_and_more'), ('sync','0001_initial')]
    target = executor.loader.graph.leaf_nodes()
    executor.migrate(before)
    old = executor.loader.project_state(before).apps
    account = old.get_model('accounts','Account').objects.create(phone='+14155552671',sequence=7)
    session = old.get_model('accounts','DeviceSession').objects.create(token_hash=digest('old-token'),account=account,
            device_name='old-device',expires_at=timezone.now()+timedelta(days=1))
    entity = old.get_model('sync','Entity').objects.create(account=account,kind='task',entity_id='old',version=1,data=task('old'))
    change = old.get_model('sync','Change').objects.create(account=account,sequence=7,kind='task',entity_id='old',version=1,data=task('old'))
    import uuid
    receipt = old.get_model('sync','Receipt').objects.create(account=account,batch_id=uuid.uuid4(),body_hash='a'*64,response={'preserved':True})
    try:
        executor = MigrationExecutor(connection); executor.migrate(target)
        assert Account.objects.get(pk=account.pk).phone == '+14155552671'
        assert Account.objects.get(pk=account.pk).sequence == 7
        assert DeviceSession.objects.get(pk=session.pk).account_id == account.pk
        assert Entity.objects.get(pk=entity.pk).account_id == account.pk
        assert Change.objects.get(pk=change.pk).account_id == account.pk
        assert Receipt.objects.get(pk=receipt.pk).response == {'preserved':True}
        client = Client(HTTP_AUTHORIZATION='Bearer old-token')
        assert pull(client).status_code == 200
        Account.objects.create(); Account.objects.create()  # multiple phone-less accounts are legal
    finally:
        MigrationExecutor(connection).migrate(target)


def test_google_only_production_startup_no_twilio_and_no_bypass():
    import os
    import subprocess
    import sys
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    base = {'PATH':os.environ.get('PATH',''), 'DEBUG':'false', 'SECRET_KEY':'x'*64,
            'DATABASE_URL':'postgresql://placeholder@127.0.0.1/wipster', 'ALLOWED_HOSTS':'sync.example.com',
            'GOOGLE_ENABLED':'true', 'GOOGLE_CLIENT_ID':CLIENT, 'OTP_PROVIDER':'disabled'}
    def check(change):
        return subprocess.run([sys.executable,'manage.py','check'],cwd=root,env={**base,**change},capture_output=True)
    assert check({}).returncode == 0
    for change in [{'GOOGLE_CLIENT_ID':''}, {'GOOGLE_CLIENT_ID':'unconfigured'}, {'GOOGLE_ENABLED':'false'},
                   {'DEV_OTP_ENABLED':'true'}, {'OTP_PROVIDER':'development'}, {'OTP_PROVIDER':'twilio'},
                   {'DATABASE_URL':'sqlite:///:memory:'}, {'SECRET_KEY':'development-only'}, {'ALLOWED_HOSTS':'*'}]:
        assert check(change).returncode != 0, change


def test_test_fixture_cannot_load_without_debug_and_explicit_opt_in():
    import os
    import subprocess
    import sys
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    base = {'PATH':os.environ.get('PATH',''), 'DEBUG':'true', 'DEV_OTP_ENABLED':'true', 'OTP_PROVIDER':'disabled',
            'GOOGLE_ENABLED':'true', 'GOOGLE_CLIENT_ID':CLIENT, 'WIPSTER_GOOGLE_TEST_PROVIDER':'1',
            'DATABASE_URL':'sqlite:////tmp/wipster-unused-fixture-guard.sqlite3'}
    for changes in [{'WIPSTER_GOOGLE_TEST_PROVIDER':''}, {'DEV_OTP_ENABLED':'false'}, {'GOOGLE_ENABLED':'false'},
                    {'DEBUG':'false','DEV_OTP_ENABLED':'false','SECRET_KEY':'x'*64,
                     'DATABASE_URL':'postgresql://placeholder@127.0.0.1/wipster','ALLOWED_HOSTS':'sync.example.com'}]:
        result = subprocess.run([sys.executable,'-c','import tests_cloud.google_mock_wsgi'],cwd=root,
                                env={**base,**changes},capture_output=True)
        assert result.returncode != 0
        assert b'Google HTTP fixture requires' in result.stderr


def test_jwks_timeout_and_oversize_are_safe_errors():
    with patch('apps.accounts.google.requests.get', side_effect=requests.Timeout('must stay private')):
        with pytest.raises(APIError) as err: google.GoogleKeys(google.JWKS_URL).fetch_data()
        assert err.value.code == 'google_unavailable'
    oversized = response_json({})
    oversized.iter_content.return_value = [b'x' * (64*1024 + 1)]
    with patch('apps.accounts.google.requests.get', return_value=oversized):
        with pytest.raises(APIError) as err: google.GoogleKeys(google.JWKS_URL).fetch_data()
        assert err.value.code == 'google_unavailable'


@pytest.mark.django_db(transaction=True)
def test_postgres_google_login_and_link_do_not_deadlock_on_existing_identity():
    """Hold I in login, then A in link: the login's deferred session FK must commit."""
    if connection.vendor != 'postgresql': pytest.skip('PostgreSQL row/FK locks required')
    from threading import Event
    account = Account.objects.create(phone='+14155552671')
    original = issue_session(account, 'existing phone device')
    session_key = digest(original['token'])
    ExternalIdentity.objects.create(issuer=google.ISSUER, subject='existing-subject', account=account)
    signed_in = Client(HTTP_AUTHORIZATION='Bearer ' + original['token'])
    _, _, login_body = begin()
    _, _, link_body = begin(signed_in, link=True)
    identity_held, account_held = Event(), Event()
    resolve = google.resolve_identity

    def interleave(claims, session):
        if session is None:
            identity = resolve(claims, session)  # holds identity I until finish commits
            identity_held.set()
            assert account_held.wait(5), 'Link never acquired its account lock'
            return identity
        account_held.set()  # finish's second live_session has locked A
        return resolve(claims, session)

    def finish(body, link):
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET statement_timeout = '10s'")
            session = DeviceSession.objects.select_related('account').get(pk=session_key) if link else None
            return google.finish(body, 'concurrent-login-link', session)
        finally:
            connection.close()

    with patch('apps.accounts.google.exchange', return_value=claims('existing-subject')) as exchange, \
            patch('apps.accounts.google.resolve_identity', side_effect=interleave):
        with ThreadPoolExecutor(2) as pool:
            login = pool.submit(finish, login_body, False)
            assert identity_held.wait(5), 'Login never acquired the identity lock'
            link = pool.submit(finish, link_body, True)
            login_result, link_result = login.result(timeout=15), link.result(timeout=15)
    assert exchange.call_count == 2  # one exchange per attempt, no consumed-proof retry
    assert login_result['account_id'] == str(account.pk)
    assert link_result['linked'] is True
    assert Account.objects.count() == ExternalIdentity.objects.count() == 1
    assert ExternalIdentity.objects.get(subject='existing-subject').account_id == account.pk
    assert DeviceSession.objects.count() == 2
    assert DeviceSession.objects.get(pk=session_key).revoked_at is None
    assert DeviceSession.objects.get(pk=digest(login_result['token'])).account_id == account.pk
    assert GoogleAttempt.objects.filter(consumed=True).count() == 2
    assert pull(signed_in).status_code == 200


def wait_for_postgres_blocker(waiter, holder):
    """Observe a real DB lock wait rather than rely on thread timing/sleeps."""
    from threading import Event
    from time import monotonic
    deadline = monotonic() + 5
    while monotonic() < deadline:
        with connection.cursor() as cursor:
            cursor.execute('SELECT %s = ANY(pg_blocking_pids(%s))', [holder, waiter])
            if cursor.fetchone()[0]: return
        Event().wait(0.01)
    pytest.fail('Expected account-lock serialization was not observed')


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize('winner', ['link', 'logout'])
def test_postgres_google_link_and_logout_keep_revocation_atomic(winner):
    """Link's weaker account lock must still serialize against actual HTTP logout."""
    if connection.vendor != 'postgresql': pytest.skip('PostgreSQL row/FK locks required')
    from threading import Event
    from apps.sync import service as sync
    account = Account.objects.create(phone='+14155552671')
    original = issue_session(account, 'existing phone device')
    key = digest(original['token'])
    client = Client(HTTP_AUTHORIZATION='Bearer ' + original['token'])
    _, _, body = begin(client, link=True)
    exchange_started, account_held = Event(), Event()
    release_exchange, release_account = Event(), Event()
    ready = {'link': Event(), 'logout': Event()}
    pids = {}
    resolve, lock_account = google.resolve_identity, sync.lock_account

    def exchange(*args):
        exchange_started.set()
        if winner == 'logout': assert release_exchange.wait(5)
        return claims('new-linked-subject')

    def resolve_while_account_locked(claims, session):
        if winner == 'link':
            account_held.set()  # second live_session holds A through identity commit
            assert release_account.wait(5)
        return resolve(claims, session)

    def logout_while_account_locked(session):
        account = lock_account(session)  # actual sync/logout lock + session recheck
        if winner == 'logout':
            account_held.set()
            assert release_account.wait(5)
        return account

    def request(action):
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET statement_timeout = '10s'")
                cursor.execute('SELECT pg_backend_pid()')
                pids[action] = cursor.fetchone()[0]
            ready[action].set()
            device = Client(HTTP_AUTHORIZATION='Bearer ' + original['token'])
            return post(device, 'auth/google/link/finish' if action == 'link' else 'auth/logout',
                        body if action == 'link' else {})
        finally:
            connection.close()

    with patch('apps.accounts.google.exchange', side_effect=exchange) as provider, \
            patch('apps.accounts.google.resolve_identity', side_effect=resolve_while_account_locked), \
            patch('apps.sync.service.lock_account', side_effect=logout_while_account_locked):
        with ThreadPoolExecutor(2) as pool:
            link = pool.submit(request, 'link')
            try:
                assert (account_held if winner == 'link' else exchange_started).wait(5)
                logout = pool.submit(request, 'logout')
                assert ready['logout'].wait(5)
                if winner == 'logout':
                    assert account_held.wait(5)
                    release_exchange.set()  # return from provider, then second live_session waits
                wait_for_postgres_blocker(pids['logout' if winner == 'link' else 'link'],
                                         pids[winner])
            finally:
                release_account.set()
                release_exchange.set()
            link_result, logout_result = link.result(timeout=15), logout.result(timeout=15)
    assert provider.call_count == 1  # no re-exchange of a consumed proof
    assert logout_result.status_code == 200
    assert link_result.status_code == (200 if winner == 'link' else 401)
    assert Account.objects.count() == DeviceSession.objects.count() == 1
    assert DeviceSession.objects.get(pk=key).revoked_at is not None
    assert GoogleAttempt.objects.get(pk=body['attempt_id']).consumed
    assert pull(client).status_code == 401
    if winner == 'link':
        assert link_result.json()['linked'] is True
        assert ExternalIdentity.objects.get(subject='new-linked-subject').account_id == account.pk
    else:
        assert link_result.json()['error'] == 'unauthorized'
        assert not ExternalIdentity.objects.exists()
