"""CSRF-protected web boundary. Native Bearer routes stay cookie-blind.

A stable HttpOnly binding references server-side pending/session state. Auth
credentials have immutable per-attempt/per-session cookie names. Server pointers
select exactly one identity, so delayed replies cannot replace newer credentials. Generation claims fence
already-dispatched stale operations under the same database row lock.
"""
import json
import secrets
import uuid
from functools import wraps
from datetime import timedelta, datetime
from django.conf import settings
from django.http import JsonResponse
from django.middleware.csrf import get_token, rotate_token
from django.views.decorators.csrf import csrf_protect
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.urls import path
from apps.accounts import service as auth, yandex
from apps.accounts.models import DeviceSession, WebBrowser, YandexAttempt
from apps.sync import service as sync
from apps.sync.encoding import JSON_PARAMS


def cookie_name(kind):
    return ('wipster_dev_' if settings.DEBUG else '__Host-wipster-') + kind


def cookie(response, kind, value, age):
    response.set_cookie(cookie_name(kind), value, max_age=age, secure=not settings.DEBUG,
                        httponly=True, samesite='Strict', path='/')


def browser_state(request, lock=False):
    selected=request.headers.get('X-Wipster-Browser')
    prefix=cookie_name('browser-')
    credentials=[(name[len(prefix):],value) for name,value in request.COOKIES.items()
                 if name.startswith(prefix) and value and len(value)<=128]
    if selected:
        credentials=[(identity,raw) for identity,raw in credentials if identity==selected]
    query=WebBrowser.objects
    if lock:query=query.select_for_update()
    states=[]
    for identity,raw in credentials[:16]:
        try:uuid.UUID(identity)
        except ValueError:continue
        state=query.filter(pk=auth.digest(raw),public_id=identity,expires_at__gt=timezone.now()).first() if len(identity)==36 else None
        if state:states.append(state)
    if len(states)>1:raise auth.APIError('browser_selection_required',409)
    if not states:raise auth.APIError('unauthorized',401)
    return states[0]


def authenticate(request, state=None):
    state = state or browser_state(request)
    token = request.COOKIES.get(cookie_name('session-' + str(state.device_id)), '')
    device = DeviceSession.objects.select_related('account').filter(
        pk=state.device_id, token_hash=auth.digest(token), channel='web', revoked_at__isnull=True,
        expires_at__gt=timezone.now()).first() if state.device_id and token and len(token)<=128 else None
    if not device:
        raise auth.APIError('unauthorized', 401)
    return device


def account(device):
    identity = device.account.identities.filter(issuer=yandex.ISSUER).first()
    return {'account_id': str(device.account_id), 'name': identity.name if identity else '',
            'email': identity.email if identity else '', 'expires_at': device.expires_at.isoformat()}


def pending(request, state):
    if not state.pending_attempt_id:
        raise auth.APIError('invalid_yandex_login')
    proof = request.COOKIES.get(cookie_name('pending-' + str(state.pending_attempt_id)), '')
    return {'attempt_id': str(state.pending_attempt_id), 'proof': proof}


def boundary(method, protected=False, coordinated=False):
    def decorate(fn):
        @wraps(fn)
        def checked(request):
            try:
                if request.method != method:
                    raise auth.APIError('method_not_allowed', 405)
                origin = request.headers.get('Origin')
                expected = ('https' if request.is_secure() else 'http') + '://' + request.get_host()
                if ((origin and origin != expected) or
                        request.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none') or
                        (method != 'GET' and origin != expected)):
                    raise auth.APIError('invalid_origin', 403)
                body = {}
                if method == 'POST':
                    try:
                        body = json.loads(request.body, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                        if not isinstance(body, dict):
                            raise ValueError()
                    except (ValueError, UnicodeDecodeError):
                        raise auth.APIError('invalid_json') from None
                if coordinated:
                    # Rate reservations commit before the fenced mutation transaction,
                    # including rejected/stale attempts. Native reserves in yandex.py.
                    action={'start':'yandex_start','status':'yandex_status','finish':'yandex_finish','cancel':'yandex_cancel','logout':'yandex_logout','claim':'yandex_status'}[fn.__name__]
                    auth.reserve_limits(action,'',request.META.get('REMOTE_ADDR','unknown'))
                    with transaction.atomic():
                        state = browser_state(request, lock=True)
                        try:
                            generation = int(request.headers.get('X-Wipster-Auth-Generation', ''))
                            if not 0 < generation <= 9007199254740991:
                                raise ValueError()
                        except (ValueError, TypeError):
                            raise auth.APIError('stale_auth_operation', 409) from None
                        if request.headers.get('X-Wipster-Browser') != str(state.public_id):
                            raise auth.APIError('stale_auth_operation', 409)
                        if coordinated == 'claim':
                            if generation < state.generation:
                                raise auth.APIError('stale_auth_operation', 409)
                            state.generation = generation
                            state.save(update_fields=['generation'])
                        elif generation != state.generation:
                            raise auth.APIError('stale_auth_operation', 409)
                        response = fn(request, body, state)
                else:
                    device = authenticate(request) if protected else None
                    if device and request.headers.get('X-Wipster-Account') != str(device.account_id):
                        raise auth.APIError('account_changed', 409)
                    response = fn(request, body, device)
                if isinstance(response, dict):
                    response = JsonResponse(response, json_dumps_params=JSON_PARAMS)
            except auth.APIError as error:
                response = JsonResponse({'error': error.code, **error.extra}, status=error.status, json_dumps_params=JSON_PARAMS)
            response['Cache-Control'] = 'no-store'
            response['Referrer-Policy'] = 'no-referrer'
            response['Vary'] = 'Cookie, Origin'
            return response
        guarded = csrf_protect(checked)
        @wraps(fn)
        def no_store(request):
            response = guarded(request)
            response['Cache-Control'] = 'no-store'
            response['Referrer-Policy'] = 'no-referrer'
            return response
        return no_store
    return decorate


@boundary('GET')
def bootstrap(request, body, device):
    raw = None
    try:
        state = browser_state(request)
    except auth.APIError as error:
        if error.status!=401:raise
        auth.reserve_limits('yandex_browser', '', request.META.get('REMOTE_ADDR', 'unknown'))
        raw = secrets.token_urlsafe(32)
        state = WebBrowser.objects.create(credential_hash=auth.digest(raw), expires_at=timezone.now()+timedelta(days=30))
    try:
        device = authenticate(request, state)
    except auth.APIError:
        device = None
    has_pending = False
    if not device and state.pending_attempt_id:
        try:
            with transaction.atomic():
                attempt = yandex.locked_attempt(pending(request, state), None, 'web')
                has_pending = attempt.status in ('pending', 'exchanging', 'ready') or (
                    attempt.status == 'finished' and attempt.result_session_id and
                    not attempt.result_session.revoked_at and attempt.result_session.expires_at > timezone.now())
        except auth.APIError:
            pass
    response = JsonResponse({'csrf': get_token(request), 'account': account(device) if device else None,
        'yandex': settings.YANDEX_ENABLED, 'pending': bool(has_pending),
        'browser_id': str(state.public_id), 'auth_generation': state.generation})
    # Only provisioning an unauthenticated binding sets this credential. All
    # later auth changes are DB state, including finish/logout lost-ack retries.
    if raw:
        cookie(response, 'browser-'+str(state.public_id), raw, 30*86400)
    # Delete only terminal immutable identities. A delayed deletion can never
    # name a future attempt/session. Unknown cookies confer no authority.
    for name,raw_cookie in list(request.COOKIES.items())[:64]:
        if name.startswith(cookie_name('session-')):
            identity=name[len(cookie_name('session-')):]
            if DeviceSession.objects.filter(pk=identity,token_hash=auth.digest(raw_cookie)).filter(
                    Q(revoked_at__isnull=False)|
                    Q(expires_at__lte=timezone.now())).exists():
                cookie(response,name[len(cookie_name('')):],'',0)
        elif name.startswith(cookie_name('pending-')):
            identity=name[len(cookie_name('pending-')):]
            try:uuid.UUID(identity)
            except ValueError:continue
            if YandexAttempt.objects.filter(pk=identity).filter(
                    Q(status__in=['cancelled','denied','failed'])|
                    Q(expires_at__lte=timezone.now())).exists():
                cookie(response,name[len(cookie_name('')):],'',0)
    return response


@boundary('POST', coordinated='claim')
def claim(request, body, state):
    if body:
        raise auth.APIError('invalid_yandex_request')
    return {'ok': True}


@boundary('POST', coordinated=True)
def start(request, body, state):
    # A lost finish acknowledgement must be redeemed/cancelled, not silently
    # replaced with another account. Binding alone never authenticates sync.
    if state.device_id:
        try:
            authenticate(request,state)
        except auth.APIError:
            # Recover an abandoned finish whose cookie was never received and
            # whose bounded pending proof is gone. Binding grants revocation,
            # never access to a current/future account without its session cookie.
            try:
                yandex.locked_attempt(pending(request,state),None,'web')
            except auth.APIError:
                DeviceSession.objects.filter(pk=state.device_id).update(revoked_at=timezone.now())
                state.device=None
                state.save(update_fields=['device'])
            else:
                raise auth.APIError('logout_required',409)
        else:
            raise auth.APIError('logout_required',409)
    cancel_pending(request,state)
    result = yandex.start(body, request.META.get('REMOTE_ADDR', 'unknown'), channel='web')
    state.pending_attempt_id = result['attempt_id']
    state.save(update_fields=['pending_attempt'])
    response=JsonResponse({'authorization_url':result['authorization_url'],'expires_in':result['expires_in']})
    # Unique credential cookie per attempt: a delayed A response cannot overwrite
    # B's proof. Server state selects exactly one pending attempt, not cookie order.
    cookie(response,'pending-'+result['attempt_id'],result['proof'],300)
    return response


@boundary('POST', coordinated=True)
def status(request, body, state):
    if body:
        raise auth.APIError('invalid_yandex_request')
    return yandex.status(pending(request, state), request.META.get('REMOTE_ADDR', 'unknown'), channel='web')


@boundary('POST', coordinated=True)
def finish(request, body, state):
    if body:
        raise auth.APIError('invalid_yandex_request')
    attempt = yandex.locked_attempt(pending(request, state), None, 'web')
    try:
        current = authenticate(request, state)
    except auth.APIError:
        current = None
    if current and current.pk != attempt.result_session_id:
        raise auth.APIError('logout_required', 409)
    result = yandex.finish(pending(request, state), request.META.get('REMOTE_ADDR', 'unknown'), channel='web')
    token=result.pop('token')
    state.device_id = auth.digest(token)
    state.save(update_fields=['device'])
    rotate_token(request)
    response=JsonResponse({'account': {k: result[k] for k in ('account_id', 'email', 'name', 'expires_at')}, 'csrf': get_token(request)})
    age=max(0,int((datetime.fromisoformat(result['expires_at'])-timezone.now()).total_seconds()))
    cookie(response,'session-'+state.device_id,token,age)
    return response


def cancel_pending(request, state):
    # The binding is a revocation capability for its own server-held attempt,
    # including an attempt whose Set-Cookie response was lost. No JS-supplied ID.
    if state.pending_attempt_id:
        attempt=YandexAttempt.objects.select_for_update().filter(pk=state.pending_attempt_id,channel='web').first()
        if attempt:
            if attempt.result_session_id:
                DeviceSession.objects.filter(pk=attempt.result_session_id,revoked_at__isnull=True).update(revoked_at=timezone.now())
                if state.device_id==attempt.result_session_id:state.device=None
            attempt.status,attempt.verifier='cancelled',''
            attempt.subject,attempt.email,attempt.name='','',''
            attempt.save(update_fields=['status','verifier','subject','email','name'])
    state.pending_attempt=None


@boundary('POST', coordinated=True)
def cancel(request, body, state):
    if body:
        raise auth.APIError('invalid_yandex_request')
    cancel_pending(request, state)
    state.save(update_fields=['pending_attempt','device'])
    return {'ok': True}


@boundary('POST', coordinated=True)
def logout(request, body, state):
    try:
        device = authenticate(request, state)
    except auth.APIError:
        device = None
    if device:
        if request.headers.get('X-Wipster-Account') != str(device.account_id):
            raise auth.APIError('account_changed', 409)
        sync.lock_account(device)
        device.revoked_at = timezone.now()
        device.save(update_fields=['revoked_at'])
    cancel_pending(request, state)
    old_device=state.device_id
    state.device = None
    state.save(update_fields=['device', 'pending_attempt'])
    rotate_token(request)
    response=JsonResponse({'ok': True, 'csrf': get_token(request)})
    if old_device:cookie(response,'session-'+old_device,'',0)
    return response


@boundary('POST', True)
def push(request, body, device):
    return sync.push(device, body)


@boundary('GET', True)
def pull(request, body, device):
    try:
        cursor, limit = int(request.GET.get('cursor', 0)), int(request.GET.get('limit', 200))
    except ValueError:
        raise auth.APIError('invalid_cursor_or_limit') from None
    return sync.pull(device, cursor, limit)

urlpatterns = [path('api/v1/web/' + name, view) for name, view in [
    ('session', bootstrap), ('claim', claim), ('yandex/start', start), ('yandex/status', status),
    ('yandex/finish', finish), ('yandex/cancel', cancel), ('logout', logout),
    ('sync/push', push), ('sync/pull', pull)]]
