import json
from functools import wraps
from django.http import JsonResponse, HttpResponse
from django.urls import path
from django.db import connection, DatabaseError, transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from apps.accounts import service as auth
from apps.accounts import google, yandex
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


@csrf_exempt
def yandex_callback(request):
    status = 200
    message = 'Вход завершён. Вернитесь в Wipster.'
    try:
        if request.method != 'GET':
            raise auth.APIError('method_not_allowed', 405)
        if yandex.callback(request.GET, request.META.get('REMOTE_ADDR', 'unknown')) == 'denied':
            message = 'Вход не разрешён. Вернитесь в Wipster и попробуйте снова.'
    except auth.APIError as error:
        status = error.status
        message = 'Не удалось завершить вход. Вернитесь в Wipster и начните заново.'
    # Only constants reach this page; no query, code, state, proof or session.
    response = HttpResponse('<!doctype html><html lang="ru"><meta charset="utf-8">'
                            '<meta name="viewport" content="width=device-width, initial-scale=1">'
                            '<title>Wipster</title><h1>Wipster</h1><p>' + message + '</p>'
                            '<p><a href="/">Вернуться в Wipster</a></p>'
                            '<p>Если вход начат в приложении с экрана Домой, откройте его снова.</p></html>', status=status)
    response['Cache-Control'] = 'no-store'
    response['Referrer-Policy'] = 'no-referrer'
    response['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    response['X-Frame-Options'] = 'DENY'
    return response


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
            cursor.execute('SELECT status, channel FROM accounts_yandexattempt LIMIT 1')
            cursor.execute('SELECT channel FROM accounts_devicesession LIMIT 1')
            cursor.execute('SELECT generation FROM accounts_webbrowser LIMIT 1')
            cursor.execute('SELECT sequence FROM sync_change LIMIT 1')
        return JsonResponse({'status': 'ok'})
    except DatabaseError:
        return JsonResponse({'status': 'unavailable'}, status=503)


urlpatterns = [path('api/v1/auth/capabilities', capabilities),
               path('api/v1/auth/yandex/callback', yandex_callback),
               *[path(f'api/v1/auth/yandex/{prefix}{name}', google_endpoint(action, link))
                 for prefix, link in [('', False), ('link/', True)]
                 for name, action in [('start', yandex.start), ('status', yandex.status),
                                      ('finish', yandex.finish), ('cancel', yandex.cancel)]],
               *[path(f'api/v1/auth/google/{prefix}{name}', google_endpoint(action, link))
                 for prefix, link in [('', False), ('link/', True)]
                 for name, action in [('start', google.start), ('finish', google.finish), ('cancel', google.cancel)]],
               path('api/v1/auth/start', start), path('api/v1/auth/verify', verify), path('api/v1/auth/logout', logout),
               path('api/v1/sync/push', push), path('api/v1/sync/pull', pull),
               path('healthz', health), path('readyz', ready), path('api/v1/health/', ready)]

# Browser cookies are accepted only by the explicitly CSRF-protected web boundary.
from .web import urlpatterns as web_urls
urlpatterns += web_urls

# Exact static routes only, after API/OAuth/health. No blanket SPA fallback.
from .pwa import urlpatterns as pwa_urls
urlpatterns += pwa_urls
