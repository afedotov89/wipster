"""Providers never log destination, credentials, codes or response bodies."""
import secrets
import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


class ProviderUnavailable(Exception):
    pass


class Development:
    def __init__(self):
        if not (settings.DEBUG and settings.DEV_OTP_ENABLED):
            raise ImproperlyConfigured('Development OTP is disabled')

    def send(self, challenge):
        from .service import digest
        code = f'{secrets.randbelow(1000000):06}'
        challenge.code_hash = digest(f'{challenge.id}:{code}')
        challenge.development_code = code

    def check(self, challenge, code):
        from .service import digest
        return secrets.compare_digest(challenge.code_hash, digest(f'{challenge.id}:{code}'))


class Twilio:
    def request(self, resource, data):
        try:
            r = requests.post(
                f'https://verify.twilio.com/v2/Services/{settings.TWILIO_VERIFY_SERVICE_SID}/{resource}',
                auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN), data=data,
                timeout=(3, 7), allow_redirects=False)
            if r.status_code == 404 and resource == 'VerificationCheck':
                return {}
            if r.status_code not in (200, 201):
                raise ProviderUnavailable()
            return r.json()
        except (requests.RequestException, ValueError):
            raise ProviderUnavailable() from None

    def send(self, challenge):
        result = self.request('Verifications', {'To': challenge.phone, 'Channel': 'sms'})
        if not result.get('sid'):
            raise ProviderUnavailable()
        challenge.provider_id = result['sid']

    def check(self, challenge, code):
        return self.request('VerificationCheck', {'VerificationSid': challenge.provider_id, 'Code': code}).get('status') == 'approved'


def provider(name):
    if name == 'development':
        return Development()
    if name == 'twilio':
        return Twilio()
    raise ProviderUnavailable()
