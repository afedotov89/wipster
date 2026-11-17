"""Real PostgreSQL/CSRF/browser binding and native compatibility regressions."""
import json
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch
import pytest
from django.test import Client, override_settings
from django.utils import timezone
from apps.accounts.models import DeviceSession, YandexAttempt, WebBrowser
from apps.accounts.service import digest
from project.web import cookie_name, pending
from tests_cloud.test_cloud import operation, task

pytestmark = pytest.mark.django_db
ORIGIN='http://testserver'
AUTH={'claim','yandex/start','yandex/status','yandex/finish','yandex/cancel','logout'}

@pytest.fixture(autouse=True)
def configured(settings):
    settings.YANDEX_ENABLED=True
    settings.YANDEX_CLIENT_ID='a'*32
    settings.YANDEX_CLIENT_SECRET=''


def browser():
    c=Client(enforce_csrf_checks=True)
    boot=c.get('/api/v1/web/session').json()
    c.generation=boot['auth_generation']
    c.defaults.update(HTTP_ORIGIN=ORIGIN,HTTP_X_CSRFTOKEN=boot['csrf'],HTTP_SEC_FETCH_SITE='same-origin',HTTP_X_WIPSTER_BROWSER=boot['browser_id'])
    return c


def rawpost(c,path,body=None,**headers):
    return c.post('/api/v1/web/'+path,json.dumps(body or {}),content_type='application/json',**headers)


def post(c,path,body=None,**headers):
    if path in AUTH and path!='claim':
        c.generation+=1;c.defaults['HTTP_X_WIPSTER_AUTH_GENERATION']=str(c.generation)
        rawpost(c,'claim',**headers)
    return rawpost(c,path,body,**headers)


def credential(c):
    return c.cookies[cookie_name('browser-'+c.defaults['HTTP_X_WIPSTER_BROWSER'])]

def binding(c):
    return WebBrowser.objects.get(pk=digest(credential(c).value))


def begin(c):
    r=post(c,'yandex/start',{'device_name':'web test'})
    assert r.status_code==200,r.content
    assert cookie_name('browser') not in r.cookies
    assert any(name.startswith(cookie_name('pending-')) for name in r.cookies)
    params=parse_qs(urlsplit(r.json()['authorization_url']).query)
    assert params['scope']==['login:email'] and params['code_challenge_method']==['S256']
    assert params['redirect_uri']==['https://wipster.fedotovs.net/api/v1/auth/yandex/callback']
    return params


def callback(params,subject='998877'):
    with patch('apps.accounts.yandex.exchange',return_value={'id':subject,'email':'web@example.com','name':'Browser'}):
        return Client().get('/api/v1/auth/yandex/callback',{'state':params['state'][0],'code':'code'})


def signin(c,subject='998877'):
    params=begin(c);assert callback(params,subject).status_code==200
    r=post(c,'yandex/finish');assert r.status_code==200,r.content
    c.defaults.update(HTTP_X_CSRFTOKEN=r.json()['csrf'],HTTP_X_WIPSTER_ACCOUNT=r.json()['account']['account_id'])
    return r


def test_origin_csrf_and_metadata_for_every_unsafe_web_path():
    c=browser()
    for path in [*AUTH,'sync/push']:
        for headers in [dict(HTTP_X_CSRFTOKEN=''),dict(HTTP_ORIGIN='https://evil.test'),dict(HTTP_ORIGIN=''),dict(HTTP_SEC_FETCH_SITE='cross-site')]:
            r=post(c,path,**headers);assert r.status_code==403,(path,r.content)
            assert r['Cache-Control']=='no-store'
    assert not YandexAttempt.objects.exists()
    assert c.get('/api/v1/web/session',HTTP_SEC_FETCH_SITE='cross-site').status_code==403


def test_http_only_binding_proof_channel_and_cross_context_finish():
    c=browser();params=begin(c)
    item=credential(c)
    assert item['httponly'] and item['samesite']=='Strict' and item['path']=='/'
    assert callback(params).status_code==200
    stranger=browser();assert post(stranger,'yandex/finish').status_code==400
    assert post(c,'yandex/status').json()=={'status':'ready'}
    state=binding(c);body=pending(SimpleNamespace(COOKIES={k:v.value for k,v in c.cookies.items()}),state)
    for action in ['status','finish','cancel']:
        assert c.post('/api/v1/auth/yandex/'+action,json.dumps(body),content_type='application/json').status_code==400
    r=post(c,'yandex/finish');assert r.status_code==200
    assert not {'token','proof','credential_hash'} & r.json().keys()
    assert cookie_name('browser') not in r.cookies and len([k for k in r.cookies if k.startswith(cookie_name('session-'))])==1
    assert c.get('/api/v1/sync/pull',HTTP_AUTHORIZATION='Bearer '+item.value).status_code==401
    assert c.get('/api/v1/sync/pull').status_code==401


def test_finish_retry_reload_and_no_auth_set_cookie_replay():
    c=browser();params=begin(c);callback(params)
    before=credential(c).value
    r=post(c,'yandex/finish');device=binding(c).device_id
    c.defaults['HTTP_X_CSRFTOKEN']=c.get('/api/v1/web/session').json()['csrf']
    retry=post(c,'yandex/finish')
    assert retry.status_code==200 and retry.json()['account']==r.json()['account']
    assert binding(c).device_id==device and DeviceSession.objects.count()==1
    assert credential(c).value==before
    assert cookie_name('browser') not in retry.cookies
    assert list(k for k in retry.cookies if k.startswith(cookie_name('session-')))==[cookie_name('session-'+device)]
    assert callback(params).status_code==400


def test_web_session_expiry_logout_and_account_header_isolation():
    c=browser();signin(c);device=binding(c).device_id
    assert c.get('/api/v1/web/sync/pull').status_code==200
    assert c.get('/api/v1/web/sync/pull',HTTP_X_WIPSTER_ACCOUNT='other').status_code==409
    assert c.get('/api/v1/web/sync/pull',HTTP_X_WIPSTER_BROWSER='00000000-0000-0000-0000-000000000001').status_code==401
    assert post(c,'logout',HTTP_X_WIPSTER_ACCOUNT='other').status_code==409
    logged_out=post(c,'logout');assert logged_out.status_code==200
    c.defaults['HTTP_X_CSRFTOKEN']=logged_out.json()['csrf']
    assert DeviceSession.objects.get(pk=device).revoked_at
    assert c.get('/api/v1/web/sync/pull').status_code==401
    assert post(c,'yandex/finish').status_code==400
    c=browser();signin(c,'112233')
    DeviceSession.objects.filter(pk=binding(c).device_id).update(expires_at=timezone.now()-timedelta(seconds=1))
    assert c.get('/api/v1/web/sync/pull').status_code==401


def test_two_browser_devices_same_identity_native_sync_and_lost_ack():
    import uuid
    a,b=browser(),browser();ra=signin(a);rb=signin(b)
    assert ra.json()['account']['account_id']==rb.json()['account']['account_id']
    payload={'batch_id':str(uuid.uuid4()),'operations':[operation('task','phone-task',task('phone-task',title='Телефон 🐈'),0)]}
    first=post(a,'sync/push',payload);assert first.status_code==200,first.content
    assert post(a,'sync/push',payload).json()==first.json()
    assert b.get('/api/v1/web/sync/pull?cursor=0&limit=1').json()['changes'][0]['data']['title']=='Телефон 🐈'
    from apps.accounts.service import issue_session
    device=DeviceSession.objects.get(pk=binding(a).device_id)
    native=Client(HTTP_AUTHORIZATION='Bearer '+issue_session(device.account,'native')['token'])
    assert native.get('/api/v1/sync/pull').json()['changes']==b.get('/api/v1/web/sync/pull').json()['changes']
    post(a,'logout')
    assert b.get('/api/v1/web/sync/pull').status_code==200
    assert native.get('/api/v1/sync/pull').status_code==200


def test_cancel_expired_pending_and_session_fixation():
    c=browser();p=begin(c);post(c,'yandex/cancel');assert callback(p).status_code==400
    p=begin(c);YandexAttempt.objects.update(expires_at=timezone.now()-timedelta(seconds=1))
    assert post(c,'yandex/status').status_code==400
    c=browser();signin(c);assert post(c,'yandex/start').status_code==409


def test_production_cookie_attributes_and_no_bearer_fallback():
    c=browser()
    with override_settings(DEBUG=False):
        from project.web import cookie
        from django.http import JsonResponse
        r=JsonResponse({});cookie(r,'browser','opaque',60);item=r.cookies['__Host-wipster-browser']
        assert item['secure'] and item['httponly'] and item['samesite']=='Strict' and not item['domain'] and item['path']=='/'
    assert c.get('/api/v1/web/sync/pull',HTTP_AUTHORIZATION='Bearer arbitrary').status_code==401


def test_generation_rejects_dispatched_stale_mutations_without_server_effect():
    c=browser();p=begin(c);old=c.generation;attempt=binding(c).pending_attempt_id
    c.generation+=1;c.defaults['HTTP_X_WIPSTER_AUTH_GENERATION']=str(c.generation)
    assert rawpost(c,'claim').status_code==200
    before=YandexAttempt.objects.count()
    for path in ['claim','yandex/start','yandex/finish','yandex/cancel','logout']:
        r=rawpost(c,path,HTTP_X_WIPSTER_AUTH_GENERATION=str(old));assert r.status_code==409
        assert not {cookie_name('browser'),cookie_name('pending'),cookie_name('session')} & r.cookies.keys()
    assert YandexAttempt.objects.count()==before and binding(c).pending_attempt_id==attempt
    assert callback(p).status_code==200
    assert rawpost(c,'yandex/finish',HTTP_X_WIPSTER_AUTH_GENERATION=str(old)).status_code==409
    assert DeviceSession.objects.count()==0
    assert rawpost(c,'yandex/finish').status_code==200


def test_late_finish_and_start_responses_cannot_overwrite_new_server_state():
    c=browser();p=begin(c);callback(p);finished=post(c,'yandex/finish');device=binding(c).device_id
    c.defaults.update(HTTP_X_CSRFTOKEN=finished.json()['csrf'],HTTP_X_WIPSTER_ACCOUNT=finished.json()['account']['account_id'])
    before_cookie=credential(c).value
    logout=post(c,'logout');assert logout.status_code==200
    c.defaults['HTTP_X_CSRFTOKEN']=logout.json()['csrf']
    assert DeviceSession.objects.get(pk=device).revoked_at
    assert binding(c).device_id is None and binding(c).pending_attempt_id is None
    # Delivering an old response cannot Set-Cookie auth back. A lost finish ack
    # is recovered through server state; only a fresh claimed start can restart.
    assert cookie_name('browser') not in finished.cookies
    assert cookie_name('session-'+device) in finished.cookies
    assert c.get('/api/v1/web/sync/pull').status_code==401
    c.cookies.update(finished.cookies)  # deliberately deliver an old response after logout
    c.defaults['HTTP_X_CSRFTOKEN']=c.get('/api/v1/web/session').json()['csrf']
    assert credential(c).value==before_cookie
    assert c.get('/api/v1/web/session').json()['pending'] is False
    assert post(c,'yandex/finish').status_code==400
    assert callback(p).status_code==400


def test_invalid_web_attempts_still_reserve_rate_limits_without_cancelling_current():
    c=browser();begin(c);attempt=binding(c).pending_attempt_id
    for i in range(19):
        assert post(c,'yandex/start',{'unexpected':True}).status_code==400
    assert post(c,'yandex/start',{'unexpected':True}).status_code==429
    assert binding(c).pending_attempt_id==attempt
    assert YandexAttempt.objects.get(pk=attempt).status=='pending'
