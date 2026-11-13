import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import pytest
import requests
from django.db import close_old_connections, connection
from django.test import Client, override_settings
from django.utils import timezone

from apps.accounts import google, yandex
from apps.accounts.models import Account, DeviceSession, ExternalIdentity, YandexAttempt
from apps.accounts.service import APIError, digest, issue_session
from tests_cloud.test_cloud import post, pull, send, operation, task
from tests_cloud.test_google import response_json, wait_for_postgres_blocker

pytestmark = pytest.mark.django_db
CLIENT = 'a' * 32


@pytest.fixture(autouse=True)
def configured():
    with override_settings(YANDEX_ENABLED=True, YANDEX_CLIENT_ID=CLIENT, YANDEX_CLIENT_SECRET='',
                           GOOGLE_ENABLED=False, OTP_PROVIDER='disabled'):
        yield


def begin(client=None, link=False):
    client = client or Client()
    result = post(client, 'auth/yandex/' + ('link/' if link else '') + 'start', {'device_name': 'test device'})
    assert result.status_code == 200, result.content
    data = result.json()
    return client, data, dict(attempt_id=data['attempt_id'], proof=data['proof'])


def profile(subject='12345', **changes):
    return {'id': subject, 'email': 'same@example.com', 'name': 'person', **changes}


def callback(data, identity=None, query=None):
    with patch('apps.accounts.yandex.exchange', return_value=identity or profile()):
        return Client().get('/api/v1/auth/yandex/callback', query or {'state': data['state'], 'code': 'opaque-code'})


def finish(client, body, link=False):
    return post(client, 'auth/yandex/' + ('link/' if link else '') + 'finish', body)


def signin(subject='12345'):
    client, data, body = begin()
    assert callback(data, profile(subject)).status_code == 200
    result = finish(client, body)
    assert result.status_code == 200, result.content
    client.defaults['HTTP_AUTHORIZATION'] = 'Bearer ' + result.json()['token']
    return client, result.json()


def test_fixed_callback_minimal_scope_pkce_proof_and_static_page():
    client, data, body = begin()
    assert client.get('/api/v1/auth/capabilities').json() == {'yandex': True, 'google': False, 'sms': False}
    attempt = YandexAttempt.objects.get(pk=data['attempt_id'])
    url = urlsplit(data['authorization_url']); params = parse_qs(url.query)
    assert url.scheme == 'https' and url.netloc == 'oauth.yandex.ru' and url.path == '/authorize'
    assert params == {'client_id':[CLIENT], 'redirect_uri':[yandex.CALLBACK], 'response_type':['code'],
                      'scope':['login:email'], 'state':[data['state']], 'code_challenge':[google.pkce(attempt.verifier)],
                      'code_challenge_method':['S256'], 'force_confirm':['yes']}
    assert attempt.proof_hash == digest(body['proof']) and body['proof'] not in data['authorization_url']
    assert data['code_challenge'] == google.pkce(attempt.verifier)
    page = callback(data)
    assert page.status_code == 200 and page['Cache-Control'] == 'no-store'
    assert page['Referrer-Policy'] == 'no-referrer' and "default-src 'none'" in page['Content-Security-Policy']
    for secret in [data['state'], body['proof'], 'opaque-code']:
        assert secret.encode() not in page.content
    attempt.refresh_from_db(); assert attempt.verifier == '' and attempt.status == 'ready'
    assert not DeviceSession.objects.exists()  # browser cannot issue a session
    assert post(client, 'auth/yandex/status', body).json() == {'status':'ready'}
    result = finish(client, body).json()
    assert result['yandex_linked'] is True and result['google_linked'] is False
    assert result['phone'] is None
    assert yandex.ISSUER == ExternalIdentity.objects.get().issuer


@pytest.mark.parametrize('body', [{'redirect_uri':'https://evil.test'}, {'client_id':'wrong'}, {'code_challenge':'a'*43},
                                  {'access_token':'attacker'}, {'email':'attacker@example.com'}])
def test_no_caller_origin_claim_or_endpoint_choices(body):
    assert post(Client(), 'auth/yandex/start', body).status_code == 400
    assert not YandexAttempt.objects.exists()


@pytest.mark.parametrize('change', [{'proof':'wrong'}, {'proof':[]}, {'proof':'\ud800'}, {'attempt_id':[]}, {'attempt_id':'unknown'}])
def test_proof_and_attempt_tampering_never_finish_or_poll_or_cancel(change):
    client, data, body = begin(); callback(data)
    for action in ('status','finish','cancel'):
        assert post(client, 'auth/yandex/' + action, {**body, **change}).status_code == 400
    assert not DeviceSession.objects.exists()


@pytest.mark.parametrize('query', [{'code':'x'}, {'state':'wrong','code':'x'}, {'state':['STATE','STATE'],'code':'x'},
    {'state':'STATE','code':['a','b']}, {'state':'STATE','error':'denied','code':'x'},
    {'state':'STATE'}, {'state':'STATE','code':''}])
def test_callback_tampering_does_not_exchange(query):
    _, data, _ = begin()
    query = {k: ([v.replace('STATE',data['state']) for v in value] if isinstance(value,list)
                 else value.replace('STATE',data['state'])) for k,value in query.items()}
    with patch('apps.accounts.yandex.exchange') as exchange:
        result = Client().get('/api/v1/auth/yandex/callback', query)
    assert result.status_code == 400
    exchange.assert_not_called()


def test_denial_expiry_and_callback_replay():
    client, data, body = begin()
    page = Client().get('/api/v1/auth/yandex/callback', {'state':data['state'], 'error':'access_denied', 'error_description':'secret'})
    assert page.status_code == 200 and b'secret' not in page.content
    assert post(client,'auth/yandex/status',body).json() == {'status':'denied'}
    assert finish(client,body).status_code == 400
    assert callback(data).status_code == 400
    client,data,body = begin()
    YandexAttempt.objects.filter(pk=data['attempt_id']).update(expires_at=timezone.now()-timedelta(seconds=1))
    assert callback(data).status_code == 400
    for action in ('status','finish','cancel'):
        assert post(client,'auth/yandex/'+action,body).status_code == 400


def test_lost_finish_response_is_idempotent_and_cancel_revokes_exact_session():
    client,data,body = begin(); callback(data)
    first = finish(client,body).json()
    assert finish(client,body).json() == first
    assert DeviceSession.objects.count() == 1
    signed = Client(HTTP_AUTHORIZATION='Bearer '+first['token'])
    assert pull(signed).status_code == 200
    assert post(client,'auth/yandex/cancel',body).status_code == 200
    assert post(client,'auth/yandex/cancel',body).status_code == 200
    assert finish(client,body).status_code == 400 and pull(signed).status_code == 401


def test_logout_prevents_finish_redelivery_and_expiry_prevents_recovery():
    client,data,body=begin(); callback(data); result=finish(client,body).json()
    post(Client(HTTP_AUTHORIZATION='Bearer '+result['token']),'auth/logout',{})
    assert finish(client,body).status_code == 400
    client,data,body=begin(); callback(data); finish(client,body)
    YandexAttempt.objects.filter(pk=data['attempt_id']).update(expires_at=timezone.now()-timedelta(seconds=1))
    assert finish(client,body).status_code == 400


def test_two_devices_isolation_and_coincident_email_provider_namespace_no_merge():
    a,first=signin(); b,second=signin(); other,third=signin('999')
    assert first['account_id'] == second['account_id'] != third['account_id']
    assert first['token'] != second['token']
    original=Account.objects.create()
    ExternalIdentity.objects.create(issuer=google.ISSUER,subject='12345',email='same@example.com',account=original)
    assert str(original.pk) != first['account_id']
    assert send(a,operation('task','private',task('private'))).status_code == 200
    assert len(pull(b).json()['changes']) == 1 and pull(other).json()['changes'] == []
    post(a,'auth/logout',{})
    assert pull(a).status_code == 401 and pull(b).status_code == 200
    assert second['google_linked'] is False
    assert issue_session(original,'old')['google_linked'] is True
    assert issue_session(original,'old')['yandex_linked'] is False


def test_explicit_link_preserves_existing_account_and_sync_collision_never_merges():
    account=Account.objects.create(phone='+14155552671'); original=issue_session(account,'old')
    client=Client(HTTP_AUTHORIZATION='Bearer '+original['token'])
    send(client,operation('task','old',task('old')))
    _,data,body=begin(client,True); callback(data)
    assert finish(Client(),body).status_code == 400
    assert finish(client,body,True).json()['linked'] is True
    assert finish(client,body,True).json()['linked'] is True
    device,result=signin()
    assert result['account_id'] == str(account.pk) and len(pull(device).json()['changes']) == 1
    assert DeviceSession.objects.count() == 2
    other=Client(HTTP_AUTHORIZATION='Bearer '+issue_session(Account.objects.create(),'other')['token'])
    _,data,body=begin(other,True); callback(data)
    collision=finish(other,body,True)
    assert collision.status_code == 409 and collision.json()['error'] == 'yandex_identity_in_use'
    assert pull(other).json()['changes'] == []
    assert ExternalIdentity.objects.get().account_id == account.pk


def test_link_requires_bound_live_device_and_cancel_during_exchange_wins():
    account=Account.objects.create(); first=issue_session(account,'one'); second=issue_session(account,'two')
    a=Client(HTTP_AUTHORIZATION='Bearer '+first['token']); b=Client(HTTP_AUTHORIZATION='Bearer '+second['token'])
    _,data,body=begin(a,True); callback(data)
    assert finish(b,body,True).status_code == 400
    post(a,'auth/logout',{})
    assert finish(a,body,True).status_code == 401
    client,data,body=begin()
    def cancelling(*args):
        assert post(client,'auth/yandex/cancel',body).status_code == 200
        return profile()
    with patch('apps.accounts.yandex.exchange',side_effect=cancelling):
        assert Client().get('/api/v1/auth/yandex/callback',{'state':data['state'],'code':'code'}).status_code == 400
    assert not ExternalIdentity.objects.exists()


def test_provider_errors_are_safe_and_consumed_code_never_retried():
    client,data,body=begin()
    with patch('apps.accounts.yandex.exchange',side_effect=APIError('yandex_unavailable',503)) as provider:
        page=Client().get('/api/v1/auth/yandex/callback',{'state':data['state'],'code':'secret'})
        assert page.status_code == 503 and b'secret' not in page.content
        assert callback(data).status_code == 400
        assert provider.call_count == 1
    assert post(client,'auth/yandex/status',body).json()['status'] == 'failed'
    assert finish(client,body).status_code == 400


def test_exchange_trusted_userinfo_headers_optional_secret_and_no_provider_retention():
    info={'id':'123','client_id':CLIENT,'default_email':'person@example.com','login':'person'}
    with patch('apps.accounts.yandex.requests.post',return_value=response_json({'access_token':'secret','refresh_token':'refresh','token_type':'bearer'})) as token, \
         patch('apps.accounts.yandex.requests.get',return_value=response_json(info)) as userinfo:
        assert yandex.exchange('code','verifier') == {'id':'123','email':'person@example.com','name':'person'}
        assert token.call_args.args == (yandex.TOKEN_URL,)
        assert token.call_args.kwargs == dict(data={'client_id':CLIENT,'code':'code','code_verifier':'verifier',
            'grant_type':'authorization_code'},timeout=(3,7),allow_redirects=False,stream=True)
        assert userinfo.call_args.args == (yandex.INFO_URL,)
        assert userinfo.call_args.kwargs == dict(params={'format':'json'},headers={'Authorization':'OAuth secret'},
            timeout=(3,7),allow_redirects=False,stream=True)
        with override_settings(YANDEX_CLIENT_SECRET='server-only'):
            yandex.exchange('code','verifier')
            assert token.call_args.kwargs['data']['client_secret'] == 'server-only'


@pytest.mark.parametrize('info',[{}, {'id':'','client_id':CLIENT}, {'id':123,'client_id':CLIENT},
                                 {'id':[], 'client_id':CLIENT},{'id':'123','client_id':'wrong'}, {'id':'123'},
                                 {'id':'evil/sub','client_id':CLIENT}])
def test_untrusted_malformed_wrong_audience_userinfo_is_rejected(info):
    with patch('apps.accounts.yandex.requests.post',return_value=response_json({'access_token':'secret','token_type':'bearer'})), \
         patch('apps.accounts.yandex.requests.get',return_value=response_json(info)):
        with pytest.raises(APIError) as error: yandex.exchange('code','verifier')
        assert error.value.code == 'yandex_unavailable'


@pytest.mark.parametrize('email',[None, [], 'not-email', '', 'x'*255+'@example.com'])
def test_missing_malformed_email_is_optional_metadata(email):
    with patch('apps.accounts.yandex.requests.post',return_value=response_json({'access_token':'secret','token_type':'bearer'})), \
         patch('apps.accounts.yandex.requests.get',return_value=response_json({'id':'123','client_id':CLIENT,'default_email':email})):
        assert yandex.exchange('code','verifier') == {'id':'123','email':'','name':''}


@pytest.mark.parametrize('bad', ['timeout','redirect','oversize','malformed','expired','token'])
def test_bounded_network_failures_never_leak_provider_errors(bad):
    response=response_json({'access_token':'secret','token_type':'bearer'})
    if bad == 'redirect': response.status_code=302
    if bad == 'expired': response.status_code=400
    if bad == 'oversize': response.iter_content.return_value=[b'x'*(64*1024+1)]
    if bad == 'malformed': response.iter_content.return_value=[b'{secret}']
    if bad == 'token': response=response_json({'access_token':'secret\r\nheader','token_type':'bearer'})
    with patch('apps.accounts.yandex.requests.post',side_effect=requests.Timeout('private') if bad=='timeout' else None,
               return_value=response), patch('apps.accounts.yandex.requests.get') as info:
        with pytest.raises(APIError) as error: yandex.exchange('code','verifier')
        assert error.value.code == 'yandex_unavailable'
        info.assert_not_called()


def test_disabled_quota_poll_budget_cleanup_and_no_provider_shortcut():
    with override_settings(YANDEX_ENABLED=False):
        assert post(Client(),'auth/yandex/start',{}).status_code == 404
        assert Client().get('/api/v1/auth/yandex/callback').status_code == 404
    client,data,body=begin()
    for _ in range(160): assert post(client,'auth/yandex/status',body).status_code == 200
    for _ in range(19): begin()
    assert post(client,'auth/yandex/start',{}).status_code == 429
    from django.core.management import call_command
    old=YandexAttempt.objects.create(proof_hash='x',state='z'*43,device_name='old',expires_at=timezone.now()-timedelta(seconds=1))
    call_command('cleanup_yandex_attempts')
    assert not YandexAttempt.objects.filter(pk=old.pk).exists()
    assert YandexAttempt.objects.filter(pk=data['attempt_id']).exists()


def test_yandex_only_production_no_google_or_secret_and_no_bypass():
    import os, subprocess, sys
    from pathlib import Path
    root=Path(__file__).resolve().parents[1]
    base={'PATH':os.environ.get('PATH',''),'DEBUG':'false','SECRET_KEY':'x'*64,
          'DATABASE_URL':'postgresql://placeholder@127.0.0.1/wipster','ALLOWED_HOSTS':'wipster.fedotovs.net',
          'YANDEX_ENABLED':'true','YANDEX_CLIENT_ID':CLIENT,'OTP_PROVIDER':'disabled'}
    def check(change): return subprocess.run([sys.executable,'manage.py','check'],cwd=root,env={**base,**change},capture_output=True)
    assert check({}).returncode == 0
    for change in [{'YANDEX_CLIENT_ID':''},{'YANDEX_CLIENT_ID':'placeholder'},{'YANDEX_ENABLED':'false'},
                   {'DEV_OTP_ENABLED':'true'},{'OTP_PROVIDER':'development'},{'DATABASE_URL':'sqlite:///:memory:'}]:
        assert check(change).returncode != 0


@pytest.mark.django_db(transaction=True)
def test_postgres_concurrent_callback_and_finish_are_once_and_recoverable():
    if connection.vendor != 'postgresql': pytest.skip('PostgreSQL locks required')
    _,data,body=begin()
    def run(action):
        close_old_connections()
        try:
            if action=='callback': return Client().get('/api/v1/auth/yandex/callback',{'state':data['state'],'code':'code'})
            return finish(Client(),body)
        finally: connection.close()
    with patch('apps.accounts.yandex.exchange',return_value=profile()) as provider:
        with ThreadPoolExecutor(2) as pool: results=list(pool.map(run,['callback','callback']))
    assert sorted(r.status_code for r in results) == [200,400] and provider.call_count == 1
    with ThreadPoolExecutor(2) as pool: results=list(pool.map(run,['finish','finish']))
    assert all(r.status_code==200 for r in results)
    assert results[0].json()==results[1].json() and DeviceSession.objects.count()==1


@pytest.mark.django_db(transaction=True)
def test_postgres_same_subject_creation_and_cross_provider_link_race():
    if connection.vendor != 'postgresql': pytest.skip('PostgreSQL locks required')
    from threading import Barrier
    _,one,body1=begin(); _,two,body2=begin(); callback(one); callback(two)
    barrier=Barrier(2)
    resolve=yandex.resolve_identity
    def interleave(attempt,session):
        barrier.wait(timeout=5)
        return resolve(attempt,session)
    def run(body):
        close_old_connections()
        try: return yandex.finish(body,'race')
        finally: connection.close()
    with patch('apps.accounts.yandex.resolve_identity',side_effect=interleave):
        with ThreadPoolExecutor(2) as pool: results=list(pool.map(run,[body1,body2]))
    assert results[0]['account_id']==results[1]['account_id']
    assert Account.objects.count()==ExternalIdentity.objects.count()==1 and DeviceSession.objects.count()==2
    # Different providers may explicitly link the same existing account concurrently.
    account=Account.objects.get(); token=results[0]['token']; signed=Client(HTTP_AUTHORIZATION='Bearer '+token)
    _,data,body=begin(signed,True); callback(data,profile('222'))
    from tests_cloud.test_google import begin as google_begin, complete as google_complete
    with override_settings(GOOGLE_ENABLED=True,GOOGLE_CLIENT_ID='test.apps.googleusercontent.com'):
        _,_,gb=google_begin(signed,True)
        def linking(provider):
            close_old_connections()
            try:
                c=Client(HTTP_AUTHORIZATION='Bearer '+token)
                return finish(c,body,True) if provider=='yandex' else google_complete(c,gb,link=True)
            finally: connection.close()
        with ThreadPoolExecutor(2) as pool: results=list(pool.map(linking,['yandex','google']))
    assert all(r.status_code==200 for r in results)
    assert ExternalIdentity.objects.filter(account=account).count()==3 and Account.objects.count()==1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize('winner',['link','logout'])
def test_postgres_yandex_link_logout_serialization(winner):
    if connection.vendor != 'postgresql': pytest.skip('PostgreSQL locks required')
    from threading import Event
    from apps.sync import service as sync
    original=issue_session(Account.objects.create(),'existing')
    client=Client(HTTP_AUTHORIZATION='Bearer '+original['token'])
    _,data,body=begin(client,True); callback(data)
    held,release=Event(),Event(); ready={'link':Event(),'logout':Event()}; pids={}
    resolve,lock_account=yandex.resolve_identity,sync.lock_account
    def resolving(attempt,session):
        if winner=='link':
            held.set(); assert release.wait(5)
        return resolve(attempt,session)
    def locking(session):
        account=lock_account(session)
        if winner=='logout':
            held.set(); assert release.wait(5)
        return account
    def run(action):
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET statement_timeout = '10s'")
                cursor.execute('SELECT pg_backend_pid()'); pids[action]=cursor.fetchone()[0]
            ready[action].set()
            c=Client(HTTP_AUTHORIZATION='Bearer '+original['token'])
            return finish(c,body,True) if action=='link' else post(c,'auth/logout',{})
        finally: connection.close()
    with patch('apps.accounts.yandex.resolve_identity',side_effect=resolving),patch('apps.sync.service.lock_account',side_effect=locking):
        with ThreadPoolExecutor(2) as pool:
            first=pool.submit(run,winner)
            try:
                assert held.wait(5)
                loser='logout' if winner=='link' else 'link'
                second=pool.submit(run,loser)
                assert ready[loser].wait(5)
                wait_for_postgres_blocker(pids[loser],pids[winner])
            finally: release.set()
            results={winner:first.result(timeout=15),loser:second.result(timeout=15)}
    assert results['logout'].status_code == 200
    assert results['link'].status_code == (200 if winner=='link' else 401)
    assert pull(client).status_code == 401
    assert ExternalIdentity.objects.count() == (1 if winner=='link' else 0)


@pytest.mark.django_db(transaction=True)
def test_postgres_yandex_login_link_existing_identity_preserves_no_key_lock_order():
    if connection.vendor != 'postgresql': pytest.skip('PostgreSQL locks required')
    from threading import Event
    account=Account.objects.create(); original=issue_session(account,'existing')
    ExternalIdentity.objects.create(issuer=yandex.ISSUER,subject='12345',account=account)
    client=Client(HTTP_AUTHORIZATION='Bearer '+original['token'])
    _,ld,lb=begin(); callback(ld)
    _,kd,kb=begin(client,True); callback(kd)
    identity_held,account_held=Event(),Event(); resolve=yandex.resolve_identity
    def interleave(attempt,session):
        if session is None:
            identity=resolve(attempt,session); identity_held.set()
            assert account_held.wait(5)
            return identity
        account_held.set()
        return resolve(attempt,session)
    def run(link):
        close_old_connections()
        try:
            with connection.cursor() as cursor: cursor.execute("SET statement_timeout = '10s'")
            c=Client(HTTP_AUTHORIZATION='Bearer '+original['token']) if link else Client()
            return finish(c,kb if link else lb,link)
        finally: connection.close()
    with patch('apps.accounts.yandex.resolve_identity',side_effect=interleave):
        with ThreadPoolExecutor(2) as pool:
            login=pool.submit(run,False)
            assert identity_held.wait(5)
            link=pool.submit(run,True)
            assert login.result(timeout=15).status_code == link.result(timeout=15).status_code == 200
    assert Account.objects.count()==ExternalIdentity.objects.count()==1 and DeviceSession.objects.count()==2
    assert pull(client).status_code == 200


@pytest.mark.django_db(transaction=True)
def test_postgres_cancel_finish_and_callback_poll_races_are_linearized():
    if connection.vendor != 'postgresql': pytest.skip('PostgreSQL locks required')
    from threading import Barrier
    client,data,body=begin(); callback(data)
    barrier=Barrier(2)
    def run(action):
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            return post(Client(),'auth/yandex/'+action,body)
        finally: connection.close()
    with ThreadPoolExecutor(2) as pool: results=list(pool.map(run,['finish','cancel']))
    assert results[1].status_code==200 and results[0].status_code in (200,400)
    assert not DeviceSession.objects.filter(revoked_at__isnull=True).exists()
    client,data,body=begin()
    def exchange(*args):
        assert post(client,'auth/yandex/status',body).json()=={'status':'exchanging'}
        return profile()
    with patch('apps.accounts.yandex.exchange',side_effect=exchange):
        assert Client().get('/api/v1/auth/yandex/callback',{'state':data['state'],'code':'code'}).status_code==200
    assert post(client,'auth/yandex/status',body).json()=={'status':'ready'}


@pytest.mark.django_db(transaction=True)
def test_yandex_migration_preserves_preexisting_google_identity_attempt_session_and_data():
    from django.db.migrations.executor import MigrationExecutor
    before=[('accounts','0004_alter_account_phone_googleattempt_externalidentity'),('sync','0001_initial')]
    executor=MigrationExecutor(connection); target=executor.loader.graph.leaf_nodes(); executor.migrate(before)
    old=executor.loader.project_state(before).apps
    account=old.get_model('accounts','Account').objects.create(sequence=8)
    device=old.get_model('accounts','DeviceSession').objects.create(token_hash=digest('old-google-session'),account=account,
        device_name='old',expires_at=timezone.now()+timedelta(days=1))
    identity=old.get_model('accounts','ExternalIdentity').objects.create(issuer=google.ISSUER,subject='old-sub',account=account,email='same@example.com')
    attempt=old.get_model('accounts','GoogleAttempt').objects.create(proof_hash='p'*64,state='s'*43,nonce='n'*43,
        challenge='c'*43,redirect_uri='http://127.0.0.1:1234/',link_session=device,expires_at=timezone.now()+timedelta(minutes=2))
    old.get_model('sync','Entity').objects.create(account=account,kind='task',entity_id='preserved',version=1,data=task('preserved'))
    try:
        MigrationExecutor(connection).migrate(target)
        assert Account.objects.get(pk=account.pk).sequence==8
        assert DeviceSession.objects.get(pk=device.pk).revoked_at is None
        assert ExternalIdentity.objects.get(pk=identity.pk).account_id==account.pk
        from apps.accounts.models import GoogleAttempt
        assert GoogleAttempt.objects.get(pk=attempt.pk).link_session_id==device.pk
        assert pull(Client(HTTP_AUTHORIZATION='Bearer old-google-session')).status_code==200
        from apps.sync.models import Entity
        assert Entity.objects.get(account_id=account.pk,entity_id='preserved').data==task('preserved')
    finally: MigrationExecutor(connection).migrate(target)


def test_yandex_http_fixture_requires_all_nonproduction_guards():
    import os,subprocess,sys
    from pathlib import Path
    base={'PATH':os.environ.get('PATH',''),'DEBUG':'true','DEV_OTP_ENABLED':'true','OTP_PROVIDER':'disabled',
          'YANDEX_ENABLED':'true','YANDEX_CLIENT_ID':CLIENT,'WIPSTER_YANDEX_TEST_PROVIDER':'1',
          'DATABASE_URL':'sqlite:////tmp/wipster-unused-yandex-fixture.sqlite3'}
    for changes in [{'WIPSTER_YANDEX_TEST_PROVIDER':''},{'DEV_OTP_ENABLED':'false'},{'YANDEX_ENABLED':'false'},
                    {'DEBUG':'false','DEV_OTP_ENABLED':'false','SECRET_KEY':'x'*64,
                     'DATABASE_URL':'postgresql://placeholder@127.0.0.1/wipster','ALLOWED_HOSTS':'wipster.fedotovs.net'}]:
        result=subprocess.run([sys.executable,'-c','import tests_cloud.yandex_mock_wsgi'],
            cwd=Path(__file__).resolve().parents[1],env={**base,**changes},capture_output=True)
        assert result.returncode!=0 and b'Yandex HTTP fixture requires' in result.stderr


def test_real_http_provider_wire_uses_pkce_and_header_userinfo_only():
    """Only the transport routing is mocked: real requests, forms, JSON and HTTP."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Thread
    from urllib.parse import parse_qs
    expected={}; seen=[]
    class Provider(BaseHTTPRequestHandler):
        def log_message(self,*args): pass  # never log code/token/query
        def reply(self,status,data):
            raw=json.dumps(data).encode(); self.send_response(status)
            self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
        def do_POST(self):
            assert self.path=='/token'
            form=parse_qs(self.rfile.read(int(self.headers['Content-Length'])).decode())
            seen.append('token')
            if form.get('code')!=['fixture-code'] or google.pkce(form['code_verifier'][0])!=expected['challenge']:
                return self.reply(400,{'error':'invalid_grant','error_description':'private'})
            assert form['client_id']==[CLIENT] and form['grant_type']==['authorization_code']
            assert 'client_secret' not in form
            self.reply(200,{'access_token':'wire-provider-token','token_type':'bearer','refresh_token':'discard'})
        def do_GET(self):
            assert self.path=='/info?format=json' and self.headers['Authorization']=='OAuth wire-provider-token'
            seen.append('userinfo')
            self.reply(200,{'id':'3456','client_id':CLIENT,'default_email':'wire@example.com'})
    server=ThreadingHTTPServer(('127.0.0.1',0),Provider); thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    original=requests.sessions.Session.send
    def local_wire(session,request,**kwargs):
        assert request.url in (yandex.TOKEN_URL,yandex.INFO_URL+'?format=json')
        assert kwargs['allow_redirects'] is False
        local=request.copy(); local.url=f'http://127.0.0.1:{server.server_port}'+urlsplit(request.url).path
        if urlsplit(request.url).query: local.url+='?'+urlsplit(request.url).query
        return original(session,local,**kwargs)
    try:
        client,data,body=begin(); expected['challenge']=data['code_challenge']
        with patch('requests.sessions.Session.send',new=local_wire):
            page=Client().get('/api/v1/auth/yandex/callback',{'state':data['state'],'code':'fixture-code'})
            assert page.status_code==200
        assert finish(client,body).json()['email']=='wire@example.com'
        assert seen==['token','userinfo']
        client,data,body=begin(); expected['challenge']='tampered'
        with patch('requests.sessions.Session.send',new=local_wire):
            page=Client().get('/api/v1/auth/yandex/callback',{'state':data['state'],'code':'fixture-code'})
            assert page.status_code==503 and b'private' not in page.content
        assert finish(client,body).status_code==400
        assert DeviceSession.objects.count()==1 and seen==['token','userinfo','token']
    finally:
        server.shutdown();server.server_close();thread.join(timeout=2)


def test_callback_provider_exception_and_userinfo_never_leak_to_logs_or_browser(caplog):
    client,data,body=begin()
    marker='PRIVATE_YANDEX_CREDENTIAL_MUST_NOT_LEAK'
    with patch('apps.accounts.yandex.requests.post',side_effect=requests.Timeout(marker)):
        page=Client().get('/api/v1/auth/yandex/callback',{'state':data['state'],'code':marker})
    assert page.status_code==503
    for value in (marker,data['state'],body['proof']):
        assert value not in caplog.text and value.encode() not in page.content
    assert finish(client,body).status_code==400


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize('winner', ['redelivery', 'logout'])
def test_postgres_lost_finish_redelivery_and_logout_never_resurrect_session(winner):
    """Force each real session-row lock winner; redelivery may only return the old token."""
    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL row locks required')
    from threading import Event
    client, data, body = begin()
    callback(data)
    first = finish(client, body).json()  # its HTTPS response can be considered lost
    held, release = Event(), Event()
    ready = {'redelivery': Event(), 'logout': Event()}
    pids = {}

    def request(action):
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET statement_timeout = '10s'")
                cursor.execute('SELECT pg_backend_pid()')
                pids[action] = cursor.fetchone()[0]
            ready[action].set()

            def pause_after_lock(execute, sql, params, many, context):
                result = execute(sql, params, many, context)
                session_lock = ('accounts_devicesession' in sql and
                    (('FOR UPDATE' in sql) if action == 'redelivery' else sql.startswith('UPDATE ')))
                if action == winner and session_lock:
                    held.set()
                    assert release.wait(5), 'Session lock was never released'
                return result

            with connection.execute_wrapper(pause_after_lock):
                if action == 'redelivery':
                    return finish(Client(), body)
                signed = Client(HTTP_AUTHORIZATION='Bearer ' + first['token'])
                return post(signed, 'auth/logout', {})
        finally:
            connection.close()

    with patch('apps.accounts.yandex.exchange') as provider:
        with ThreadPoolExecutor(2) as pool:
            first_request = pool.submit(request, winner)
            try:
                assert held.wait(5), 'Winner did not acquire its session-row lock'
                loser = 'logout' if winner == 'redelivery' else 'redelivery'
                second_request = pool.submit(request, loser)
                assert ready[loser].wait(5)
                wait_for_postgres_blocker(pids[loser], pids[winner])
            finally:
                release.set()
            results = {winner: first_request.result(timeout=15), loser: second_request.result(timeout=15)}
        provider.assert_not_called()
    assert results['logout'].status_code == 200
    assert results['redelivery'].status_code == (200 if winner == 'redelivery' else 400)
    if winner == 'redelivery':
        assert results['redelivery'].json() == first  # same token, UUID and expiration
    assert DeviceSession.objects.count() == 1
    assert DeviceSession.objects.get().revoked_at is not None
    assert YandexAttempt.objects.get(pk=body['attempt_id']).result_session_id == digest(first['token'])
    assert finish(Client(), body).status_code == 400
    assert pull(Client(HTTP_AUTHORIZATION='Bearer ' + first['token'])).status_code == 401
