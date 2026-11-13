"""Google OIDC for Desktop public clients. No credentials/claims/bodies are logged."""
import base64
import hashlib
import hmac
import re
import secrets
import uuid
from datetime import timedelta
from functools import lru_cache
from urllib.parse import urlsplit, urlencode

import jwt
import requests
from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from .models import Account, DeviceSession, ExternalIdentity, GoogleAttempt
from .service import APIError, digest, issue_session, reserve_limits

ISSUER = 'https://accounts.google.com'
AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'


def enabled():
    if not settings.GOOGLE_ENABLED:
        raise APIError('google_disabled', 404)


def capabilities():
    return {'google': settings.GOOGLE_ENABLED, 'sms': settings.OTP_PROVIDER != 'disabled'}


def bounded_json(response):
    if response.status_code != 200:
        raise APIError('google_unavailable', 503)
    raw = bytearray()
    for chunk in response.iter_content(8192):
        raw.extend(chunk)
        if len(raw) > 64 * 1024:
            raise APIError('google_unavailable', 503)
    import json
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError()
    return result


class GoogleKeys(jwt.PyJWKClient):
    def fetch_data(self):
        try:
            with requests.get(JWKS_URL, timeout=(3, 5), allow_redirects=False, stream=True) as response:
                data = bounded_json(response)
            if self.jwk_set_cache is not None:
                self.jwk_set_cache.put(data)
            return data
        except (requests.RequestException, ValueError, APIError):
            raise APIError('google_unavailable', 503) from None


@lru_cache(maxsize=1)
def keys():
    # Refresh on cache expiry and unknown kid. Never cache individual keys forever.
    return GoogleKeys(JWKS_URL, cache_jwk_set=True, lifespan=300, cache_keys=False, timeout=5)


def verify_id_token(raw, nonce):
    if not isinstance(raw, str) or len(raw) > 16000:
        raise APIError('invalid_google_login')
    try:
        key = keys().get_signing_key_from_jwt(raw)
        claims = jwt.decode(raw, key.key, algorithms=['RS256'], audience=settings.GOOGLE_CLIENT_ID,
                            issuer=[ISSUER, 'accounts.google.com'],
                            options={'require': ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce'], 'strict_aud': True})
        if claims.get('azp', settings.GOOGLE_CLIENT_ID) != settings.GOOGLE_CLIENT_ID:
            raise ValueError()
        if not isinstance(claims['sub'], str) or not 1 <= len(claims['sub']) <= 255:
            raise ValueError()
        if not isinstance(claims['nonce'], str) or not hmac.compare_digest(claims['nonce'], nonce):
            raise ValueError()
        # Normalize the two documented issuer spellings to one identity namespace.
        return claims
    except (jwt.PyJWTError, ValueError, TypeError):
        raise APIError('invalid_google_login') from None


def exchange(code, verifier, redirect_uri, nonce):
    data = {'code': code, 'code_verifier': verifier, 'redirect_uri': redirect_uri,
            'client_id': settings.GOOGLE_CLIENT_ID, 'grant_type': 'authorization_code'}
    if settings.GOOGLE_CLIENT_SECRET:
        data['client_secret'] = settings.GOOGLE_CLIENT_SECRET
    try:
        with requests.post(TOKEN_URL, data=data, timeout=(3, 7), allow_redirects=False, stream=True) as response:
            if response.status_code == 400:
                raise APIError('invalid_google_login')
            result = bounded_json(response)
    except (requests.RequestException, ValueError):
        raise APIError('google_unavailable', 503) from None
    # No Google access/refresh tokens are retained or returned.
    return verify_id_token(result.get('id_token'), nonce)


def pkce(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()


def start(body, ip, session=None):
    enabled()
    reserve_limits('google_start', 'google', ip)
    redirect, challenge = body.get('redirect_uri'), body.get('code_challenge')
    try:
        uri = urlsplit(redirect)
        valid = (uri.scheme == 'http' and uri.hostname == '127.0.0.1' and uri.port and
                 uri.netloc == f'127.0.0.1:{uri.port}' and uri.path == '/' and not uri.query and not uri.fragment)
    except (ValueError, TypeError, AttributeError):
        valid = False
    if not valid or not isinstance(challenge, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', challenge):
        raise APIError('invalid_google_request')
    proof = secrets.token_urlsafe(32)
    attempt = GoogleAttempt.objects.create(proof_hash=digest(proof), state=secrets.token_urlsafe(32),
        nonce=secrets.token_urlsafe(32), challenge=challenge, redirect_uri=redirect, link_session=session,
        expires_at=timezone.now() + timedelta(minutes=5))
    params = {'client_id': settings.GOOGLE_CLIENT_ID, 'redirect_uri': redirect, 'response_type': 'code',
              'scope': 'openid email', 'state': attempt.state, 'nonce': attempt.nonce,
              'code_challenge': challenge, 'code_challenge_method': 'S256', 'prompt': 'select_account'}
    return {'attempt_id': str(attempt.id), 'proof': proof, 'state': attempt.state,
            'authorization_url': AUTH_URL + '?' + urlencode(params), 'expires_in': 300}


def attempt_id(body):
    try:
        return uuid.UUID(str(body.get('attempt_id')))
    except (ValueError, TypeError):
        raise APIError('invalid_google_login') from None


def proof_matches(attempt, body, session):
    proof = body.get('proof')
    return (attempt and isinstance(proof, str) and len(proof) <= 100 and
            hmac.compare_digest(attempt.proof_hash, digest(proof)) and
            attempt.link_session_id == (session.pk if session else None))


def live_session(session):
    # Serialize with sync/logout's FOR UPDATE, without blocking a concurrent login's
    # deferred session FK (KEY SHARE). FOR UPDATE here would deadlock when login
    # holds the identity and link holds this account before waiting for that identity.
    # We never change account keys; NO KEY UPDATE still excludes logout until commit.
    Account.objects.select_for_update(no_key=True).get(pk=session.account_id)
    if not DeviceSession.objects.filter(pk=session.pk, revoked_at__isnull=True, expires_at__gt=timezone.now()).exists():
        raise APIError('unauthorized', 401)


def cancel(body, ip, session=None):
    enabled()
    reserve_limits('google_cancel', 'google', ip)
    with transaction.atomic():
        attempt = GoogleAttempt.objects.select_for_update().filter(pk=attempt_id(body)).first()
        if not proof_matches(attempt, body, session):
            raise APIError('invalid_google_login')
        attempt.cancelled = True
        attempt.save(update_fields=['cancelled'])
    return {'ok': True}


def resolve_identity(claims, session):
    subject = claims['sub']
    identity = ExternalIdentity.objects.select_for_update().filter(issuer=ISSUER, subject=subject).first()
    if identity is None:
        try:
            # The savepoint rolls back a speculative account on a same-sub creation race.
            with transaction.atomic():
                account = session.account if session else Account.objects.create()
                identity = ExternalIdentity.objects.create(issuer=ISSUER, subject=subject, account=account)
        except IntegrityError:
            identity = ExternalIdentity.objects.select_for_update().get(issuer=ISSUER, subject=subject)
    if session and identity.account_id != session.account_id:
        raise APIError('google_identity_in_use', 409)
    # Only verified email is displayed. Name is optional; profile scope is not requested.
    verified = claims.get('email_verified') is True or claims.get('email_verified') == 'true'
    email = claims.get('email', '') if verified else ''
    identity.email = email[:254] if isinstance(email, str) else ''
    name = claims.get('name', '')
    identity.name = name[:200] if isinstance(name, str) else ''
    identity.save(update_fields=['email', 'name'])
    return identity


def finish(body, ip, session=None):
    enabled()
    reserve_limits('google_finish', 'google', ip)
    with transaction.atomic():
        if session:
            live_session(session)
        attempt = GoogleAttempt.objects.select_for_update().filter(pk=attempt_id(body)).first()
        if not proof_matches(attempt, body, session) or attempt.consumed or attempt.cancelled or attempt.expires_at <= timezone.now():
            raise APIError('invalid_google_login')
        verifier, state, code = body.get('code_verifier'), body.get('state'), body.get('code')
        if (not isinstance(verifier, str) or not re.fullmatch(r'[A-Za-z0-9._~-]{43,128}', verifier) or
                not isinstance(state, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', state) or not hmac.compare_digest(state, attempt.state) or
                not hmac.compare_digest(pkce(verifier), attempt.challenge) or
                not isinstance(code, str) or not 1 <= len(code) <= 4096):
            raise APIError('invalid_google_login')
        attempt.consumed = True
        attempt.save(update_fields=['consumed'])
    # Committed before the external request: a code/proof can be exchanged once across workers.
    claims = exchange(code, verifier, attempt.redirect_uri, attempt.nonce)
    with transaction.atomic():
        if session:
            live_session(session)
        attempt = GoogleAttempt.objects.select_for_update().get(pk=attempt.pk)
        if attempt.cancelled or attempt.expires_at <= timezone.now():
            raise APIError('invalid_google_login')
        identity = resolve_identity(claims, session)
        if session:
            return {'linked': True, 'email': identity.email, 'name': identity.name, 'google_linked': True}
        return issue_session(identity.account, body.get('device_name'), identity)
