"""Fixed server callback + durable native proof channel. No provider token storage."""
import hmac
import json
import re
import secrets
from datetime import timedelta
from time import monotonic
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.utils import timezone

from .google import live_session, pkce, attempt_id
from .models import Account, DeviceSession, ExternalIdentity, YandexAttempt
from .service import APIError, digest, issue_session, reserve_limits

ISSUER = 'https://login.yandex.ru'
AUTH_URL = 'https://oauth.yandex.ru/authorize'
TOKEN_URL = 'https://oauth.yandex.ru/token'
INFO_URL = 'https://login.yandex.ru/info'
CALLBACK = 'https://wipster.fedotovs.net/api/v1/auth/yandex/callback'


def enabled():
    if not settings.YANDEX_ENABLED:
        raise APIError('yandex_disabled', 404)


def bounded_json(response, deadline):
    if response.status_code != 200:
        raise APIError('yandex_unavailable', 503)
    raw = bytearray()
    for chunk in response.iter_content(8192):
        raw.extend(chunk)
        if len(raw) > 64 * 1024 or monotonic() > deadline:
            raise APIError('yandex_unavailable', 503)
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError()
    return result


def exchange(code, verifier):
    data = {'grant_type': 'authorization_code', 'client_id': settings.YANDEX_CLIENT_ID,
            'code': code, 'code_verifier': verifier}
    if settings.YANDEX_CLIENT_SECRET:
        data['client_secret'] = settings.YANDEX_CLIENT_SECRET
    try:
        deadline = monotonic() + 20
        with requests.post(TOKEN_URL, data=data, timeout=(3, 7), allow_redirects=False, stream=True) as response:
            result = bounded_json(response, deadline)
        token = result.get('access_token')
        if (not isinstance(token, str) or not 1 <= len(token) <= 8192 or
                not re.fullmatch(r'[\x21-\x7e]+', token) or result.get('token_type') != 'bearer'):
            raise ValueError()
        # Provider credentials remain in this stack frame only. No query bearer token.
        with requests.get(INFO_URL, params={'format': 'json'}, headers={'Authorization': 'OAuth ' + token},
                          timeout=(3, 7), allow_redirects=False, stream=True) as response:
            info = bounded_json(response, deadline)
        subject = info.get('id')
        if (not isinstance(subject, str) or not re.fullmatch(r'[0-9]{1,255}', subject) or
                info.get('client_id') != settings.YANDEX_CLIENT_ID):
            raise ValueError()
        email = info.get('default_email', '')
        try:
            if not isinstance(email, str) or len(email) > 254:
                raise ValidationError('Invalid email')
            validate_email(email)
        except ValidationError:
            email = ''  # metadata never authenticates, and may be absent
        name = info.get('login', '')  # base field; no login:info scope
        return {'id': subject, 'email': email, 'name': name[:200] if isinstance(name, str) and name.isprintable() else ''}
    except (requests.RequestException, ValueError, TypeError, UnicodeError):
        raise APIError('yandex_unavailable', 503) from None


def start(body, ip, session=None):
    enabled()
    reserve_limits('yandex_start', '', ip)
    # Reject caller-directed endpoints/claims rather than silently accepting them.
    if set(body) - {'device_name'}:
        raise APIError('invalid_yandex_request')
    proof, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    with transaction.atomic():
        if session:
            live_session(session)
        attempt = YandexAttempt.objects.create(proof_hash=digest(proof), state=secrets.token_urlsafe(32),
            verifier=verifier, link_session=session, device_name=str(body.get('device_name') or 'Wipster')[:100],
            expires_at=timezone.now() + timedelta(minutes=5))
    params = {'client_id': settings.YANDEX_CLIENT_ID, 'redirect_uri': CALLBACK, 'response_type': 'code',
              'scope': 'login:email', 'state': attempt.state, 'code_challenge': pkce(verifier),
              'code_challenge_method': 'S256', 'force_confirm': 'yes'}
    return {'attempt_id': str(attempt.pk), 'proof': proof, 'state': attempt.state,
            'code_challenge': params['code_challenge'], 'authorization_url': AUTH_URL + '?' + urlencode(params),
            'expires_in': 300}


def callback(query, ip):
    enabled()
    reserve_limits('yandex_callback', '', ip)
    states, codes, errors = (query.getlist(k) for k in ('state', 'code', 'error'))
    if (len(states) != 1 or not re.fullmatch(r'[A-Za-z0-9_-]{43}', states[0]) or
            not ((len(codes) == 1 and not errors and 1 <= len(codes[0]) <= 4096) or
                 (len(errors) == 1 and not codes and 1 <= len(errors[0]) <= 100))):
        raise APIError('invalid_yandex_login')
    with transaction.atomic():
        attempt = YandexAttempt.objects.select_for_update().filter(state=states[0]).first()
        if not attempt or attempt.status != 'pending' or attempt.expires_at <= timezone.now():
            raise APIError('invalid_yandex_login')
        verifier = attempt.verifier
        attempt.verifier = ''
        attempt.status = 'denied' if errors else 'exchanging'
        attempt.save(update_fields=['status', 'verifier'])
    if errors:
        return 'denied'
    try:
        profile = exchange(codes[0], verifier)
    except APIError:
        with transaction.atomic():
            YandexAttempt.objects.filter(pk=attempt.pk, status='exchanging').update(status='failed')
        raise
    with transaction.atomic():
        attempt = YandexAttempt.objects.select_for_update().get(pk=attempt.pk)
        if attempt.status != 'exchanging' or attempt.expires_at <= timezone.now():
            raise APIError('invalid_yandex_login')
        attempt.subject, attempt.email, attempt.name = profile['id'], profile['email'], profile['name']
        attempt.status = 'ready'
        attempt.save(update_fields=['subject', 'email', 'name', 'status'])
    return 'ready'


def locked_attempt(body, session):
    try:
        key = attempt_id(body)
    except APIError:
        raise APIError('invalid_yandex_login') from None
    attempt = YandexAttempt.objects.select_for_update().filter(pk=key).first()
    proof = body.get('proof')
    if (not attempt or not isinstance(proof, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', proof) or
            not hmac.compare_digest(attempt.proof_hash, digest(proof)) or
            attempt.link_session_id != (session.pk if session else None) or attempt.expires_at <= timezone.now()):
        raise APIError('invalid_yandex_login')
    return attempt


def status(body, ip, session=None):
    enabled()
    reserve_limits('yandex_status', '', ip)
    with transaction.atomic():
        if session:
            live_session(session)
        attempt = locked_attempt(body, session)
        return {'status': attempt.status}


def cancel(body, ip, session=None):
    enabled()
    reserve_limits('yandex_cancel', '', ip)
    with transaction.atomic():
        if session:
            live_session(session)
        attempt = locked_attempt(body, session)
        if attempt.result_session_id:
            DeviceSession.objects.filter(pk=attempt.result_session_id, revoked_at__isnull=True).update(revoked_at=timezone.now())
        attempt.status, attempt.verifier = 'cancelled', ''
        attempt.subject, attempt.email, attempt.name = '', '', ''
        attempt.save(update_fields=['status', 'verifier', 'subject', 'email', 'name'])
    return {'ok': True}


def resolve_identity(attempt, session):
    identity = ExternalIdentity.objects.select_for_update().filter(issuer=ISSUER, subject=attempt.subject).first()
    if identity is None:
        try:
            with transaction.atomic():
                account = session.account if session else Account.objects.create()
                identity = ExternalIdentity.objects.create(issuer=ISSUER, subject=attempt.subject, account=account)
        except IntegrityError:
            identity = ExternalIdentity.objects.select_for_update().get(issuer=ISSUER, subject=attempt.subject)
    if session and identity.account_id != session.account_id:
        raise APIError('yandex_identity_in_use', 409)
    identity.email, identity.name = attempt.email, attempt.name
    identity.save(update_fields=['email', 'name'])
    return identity


def finish(body, ip, session=None):
    enabled()
    reserve_limits('yandex_finish', '', ip)
    with transaction.atomic():
        if session:
            live_session(session)
        attempt = locked_attempt(body, session)
        if attempt.status not in ('ready', 'finished'):
            raise APIError('invalid_yandex_login')
        if session:
            if attempt.status == 'ready':
                resolve_identity(attempt, session)
                attempt.status = 'finished'
                attempt.save(update_fields=['status'])
            return {'linked': True, 'email': attempt.email, 'name': attempt.name, 'yandex_linked': True}
        # Recover a lost HTTPS response without retaining a bearer token in the DB.
        # A hash of the proof cannot recover this domain-separated session token.
        token = digest('yandex-device-session:' + str(attempt.pk) + ':' + body['proof'])
        if attempt.status == 'finished':
            device = DeviceSession.objects.select_for_update().get(pk=attempt.result_session_id)
            if device.revoked_at or device.expires_at <= timezone.now():
                raise APIError('invalid_yandex_login')
            return {'token': token, 'account_id': str(device.account_id), 'phone': device.account.phone,
                    'email': attempt.email, 'name': attempt.name, 'yandex_linked': True,
                    'google_linked': device.account.identities.filter(issuer='https://accounts.google.com').exists(),
                    'expires_at': device.expires_at.isoformat()}
        identity = resolve_identity(attempt, None)
        result = issue_session(identity.account, attempt.device_name, identity, token=token)
        attempt.status, attempt.result_session_id = 'finished', digest(token)
        attempt.save(update_fields=['status', 'result_session'])
        return result
