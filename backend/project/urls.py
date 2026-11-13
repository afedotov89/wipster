import json
from functools import wraps
from django.http import JsonResponse
from django.urls import path
from django.db import connection, DatabaseError, transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from apps.accounts import service as auth
from apps.accounts import google
from apps.sync import service as sync
from apps.sync.encoding import JSON_PARAMS


def endpoint(method, authenticated=False):
    def decorate(fn):
        @csrf_exempt
        @wraps(fn)
        def wrapped(request):
            try:
                if request.method != method:
                    raise auth.APIError('method_not_allowed', 405)
                session = auth.authenticate(request) if authenticated else None
                body = {}
                if method == 'POST':
                    try:
                        body = json.loads(request.body, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                        if not isinstance(body, dict):
                            raise ValueError()
                    except (ValueError, UnicodeDecodeError):
                        raise auth.APIError('invalid_json') from None
                response = JsonResponse(fn(request, body, session), json_dumps_params=JSON_PARAMS)
            except auth.APIError as e:
                response = JsonResponse({'error': e.code, **e.extra}, status=e.status, json_dumps_params=JSON_PARAMS)
            response['Cache-Control'] = 'no-store'
            response['Referrer-Policy'] = 'no-referrer'
            return response
        return wrapped
    return decorate


@endpoint('GET')
def capabilities(request, body, session):
    return google.capabilities()


def google_endpoint(action, link=False):
    @endpoint('POST', link)
    def handler(request, body, session):
        return action(body, request.META.get('REMOTE_ADDR', 'unknown'), session)
    return handler


@endpoint('POST')
def start(request, body, session):
    return auth.start(body.get('phone'), request.META.get('REMOTE_ADDR', 'unknown'))


@endpoint('POST')
def verify(request, body, session):
    return auth.verify(body.get('challenge_id'), body.get('code'), request.META.get('REMOTE_ADDR', 'unknown'), body.get('device_name'))


@endpoint('POST', True)
def logout(request, body, session):
    with transaction.atomic():
        sync.lock_account(session)
        session.revoked_at = timezone.now()
        session.save(update_fields=['revoked_at'])
    return {'ok': True}


@endpoint('POST', True)
def push(request, body, session):
    return sync.push(session, body)


@endpoint('GET', True)
def pull(request, body, session):
    try:
        cursor, limit = int(request.GET.get('cursor', 0)), int(request.GET.get('limit', 200))
    except ValueError:
        raise auth.APIError('invalid_cursor_or_limit') from None
    return sync.pull(session, cursor, limit)


def health(request):
    return JsonResponse({'status': 'ok'})


def ready(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT sequence FROM accounts_account LIMIT 1')
            cursor.execute('SELECT phone FROM accounts_phoneidentity LIMIT 1')
            cursor.execute('SELECT subject FROM accounts_externalidentity LIMIT 1')
            cursor.execute('SELECT consumed FROM accounts_googleattempt LIMIT 1')
            cursor.execute('SELECT sequence FROM sync_change LIMIT 1')
        return JsonResponse({'status': 'ok'})
    except DatabaseError:
        return JsonResponse({'status': 'unavailable'}, status=503)


urlpatterns = [path('api/v1/auth/capabilities', capabilities),
               *[path(f'api/v1/auth/google/{prefix}{name}', google_endpoint(action, link))
                 for prefix, link in [('', False), ('link/', True)]
                 for name, action in [('start', google.start), ('finish', google.finish), ('cancel', google.cancel)]],
               path('api/v1/auth/start', start), path('api/v1/auth/verify', verify), path('api/v1/auth/logout', logout),
               path('api/v1/sync/push', push), path('api/v1/sync/pull', pull),
               path('healthz', health), path('readyz', ready), path('api/v1/health/', ready)]
