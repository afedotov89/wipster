"""Opt-in loopback-only native HTTP fixture. Not imported by production WSGI."""
import os
from unittest.mock import patch
from django.core.exceptions import ImproperlyConfigured
from project.wsgi import application
from django.conf import settings

if not (settings.DEBUG and settings.DEV_OTP_ENABLED and settings.YANDEX_ENABLED and
        os.environ.get('WIPSTER_YANDEX_TEST_PROVIDER') == '1'):
    raise ImproperlyConfigured('Yandex HTTP fixture requires DEBUG + DEV_OTP_ENABLED + explicit test opt-in')

from apps.accounts import yandex
import json
from unittest.mock import Mock
from apps.accounts.google import pkce


def response_json(data, status=200):
    response = Mock(status_code=status)
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=None)
    response.iter_content.return_value = [json.dumps(data).encode()]
    return response


def token(url, **kwargs):
    data = kwargs['data']
    parts = data.get('code', '').split(':')
    if (url != yandex.TOKEN_URL or len(parts) != 3 or parts[0] != 'native-mock-code' or
            parts[1] != pkce(data.get('code_verifier', '')) or not parts[2].isdigit() or kwargs['allow_redirects']):
        return response_json({},400)
    return response_json({'access_token':'native-provider-token:' + parts[2], 'token_type':'bearer','refresh_token':'discarded'})


def info(url, **kwargs):
    header = kwargs.get('headers', {}).get('Authorization', '')
    prefix = 'OAuth native-provider-token:'
    if url != yandex.INFO_URL or not header.startswith(prefix) or not header[len(prefix):].isdigit():
        return response_json({},401)
    return response_json({'id':header[len(prefix):], 'client_id':settings.YANDEX_CLIENT_ID,
                          'default_email':'native-test@example.com','login':'native-user'})


# Only provider HTTP is mocked. All real state/proof/PKCE, identity/session and DB paths run.
patch('apps.accounts.yandex.requests.post',side_effect=token).start()
patch('apps.accounts.yandex.requests.get',side_effect=info).start()
