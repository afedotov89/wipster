"""Opt-in local HTTP test fixture, NOT a production authentication adapter.

Run ONLY with the guards below and bind Gunicorn to 127.0.0.1. Native tests
replace opening a browser at compile time; all actual JWT validation still runs.
"""
import os
import json
from unittest.mock import Mock, patch
from django.core.exceptions import ImproperlyConfigured
from project.wsgi import application  # configure the real app before testing its settings
from django.conf import settings

if not (settings.DEBUG and settings.DEV_OTP_ENABLED and
        os.environ.get('WIPSTER_GOOGLE_TEST_PROVIDER') == '1' and settings.GOOGLE_ENABLED):
    raise ImproperlyConfigured('Google HTTP fixture requires DEBUG + DEV_OTP_ENABLED + explicit test opt-in')

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from django.utils import timezone
from apps.accounts import google
from apps.accounts.models import GoogleAttempt

_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_jwk = {**json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(_key.public_key())), 'kid':'local-test-key', 'use':'sig','alg':'RS256'}
_post, _get = google.requests.post, google.requests.get


def response(data):
    result = Mock(status_code=200)
    result.__enter__ = Mock(return_value=result); result.__exit__ = Mock(return_value=None)
    result.iter_content.return_value = [json.dumps(data).encode()]
    return result


def token(url, **kwargs):
    if url != google.TOKEN_URL: return _post(url, **kwargs)
    data = kwargs['data']
    if data.get('code') != 'native-mock-subject':
        return response({})
    attempt = GoogleAttempt.objects.filter(redirect_uri=data['redirect_uri'],consumed=True,cancelled=False).latest('expires_at')
    now = int(timezone.now().timestamp())
    raw = jwt.encode(dict(iss=google.ISSUER,aud=settings.GOOGLE_CLIENT_ID,sub='native-mock-subject',
                          nonce=attempt.nonce,iat=now,exp=now+300,email='native-test@example.com',email_verified=True),
                     _key,algorithm='RS256',headers={'kid':'local-test-key'})
    return response({'id_token':raw,'access_token':'discarded-test-value'})


def jwks(url, **kwargs):
    if url != google.JWKS_URL: return _get(url, **kwargs)
    return response({'keys':[_jwk]})


# Mock at the external HTTP provider boundary, not at identity verification/session issuance.
patch('apps.accounts.google.requests.post', side_effect=token).start()
patch('apps.accounts.google.requests.get', side_effect=jwks).start()
