import hashlib
import hmac
import re
import secrets
from datetime import timedelta
import phonenumbers
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from .models import Account, Challenge, DeviceSession, RateBucket, PhoneIdentity
from .providers import provider, ProviderUnavailable


class APIError(Exception):
    def __init__(self, code, status=400, **extra):
        self.code, self.status, self.extra = code, status, extra


def digest(value):
    return hmac.new(settings.SECRET_KEY.encode(), value.encode(), hashlib.sha256).hexdigest()


def canonical_phone(value):
    if not isinstance(value, str) or not re.fullmatch(r'\+[1-9]\d{7,14}', value):
        raise APIError('invalid_phone')
    try:
        number = phonenumbers.parse(value, None)
        if phonenumbers.is_valid_number(number) and phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164) == value:
            return value
    except phonenumbers.NumberParseException:
        pass
    raise APIError('invalid_phone')


def reserve_limits(action, phone, ip):
    """Commit reservations before rejecting, locking global/IP before phone rows."""
    now = timezone.now()
    starting = action in ('send', 'google_start', 'yandex_start')
    scopes = [('global', 600 if starting else 3000),
              ('ip:' + ip, 20 if starting else 100)]
    if action == 'yandex_status':
        scopes = [('global', 18000), ('ip:' + ip, 900)]
    if not action.startswith(('google_', 'yandex_')):
        scopes.append(('phone:' + phone, 5 if action == 'send' else 30))
    limits = [(f'{action}:{scope}:{int(now.timestamp()) // 3600}', cap, 3600) for scope, cap in scopes]
    if action == 'send':
        limits.append((f'send:cooldown:{phone}:{int(now.timestamp()) // 60}', 1, 60))
    allowed = True
    # Fixed ordering avoids deadlock. get_or_create handles first-writer unique races.
    with transaction.atomic():
        for raw, cap, period in limits:
            row, _ = RateBucket.objects.get_or_create(key=digest(raw), defaults={'expires_at': now + timedelta(seconds=period * 2)})
            row = RateBucket.objects.select_for_update().get(pk=row.pk)
            allowed &= row.count < cap
            row.count = min(row.count + 1, cap + 1)
            row.save(update_fields=['count'])
            if not allowed:
                break  # Do not allocate arbitrary phone buckets after global/IP exhaustion.
    if not allowed:
        raise APIError('rate_limited', 429)


def start(phone, ip):
    if settings.OTP_PROVIDER == 'disabled':
        raise APIError('sms_disabled', 404)
    phone = canonical_phone(phone)
    reserve_limits('send', phone, ip)
    error = None
    with transaction.atomic():
        identity, _ = PhoneIdentity.objects.get_or_create(phone=phone)
        PhoneIdentity.objects.select_for_update().get(pk=identity.pk)
        # Only the latest challenge can authorize this phone. The phone lock is
        # acquired before challenge locks in both start and verify.
        Challenge.objects.filter(phone=phone, consumed=False).update(consumed=True, development_code='')
        challenge = Challenge(phone=phone, provider=settings.OTP_PROVIDER, expires_at=timezone.now() + timedelta(minutes=5))
        challenge.save()
        try:
            provider(challenge.provider).send(challenge)
            challenge.sent = True
            challenge.save()
        except ProviderUnavailable:
            error = APIError('provider_unavailable', 503)
    if error:
        raise error
    return {'challenge_id': str(challenge.id), 'expires_in': 300}



def verify(challenge_id, code, ip, device_name):
    if settings.OTP_PROVIDER == 'disabled':
        raise APIError('sms_disabled', 404)
    try:
        import uuid
        challenge_id = uuid.UUID(str(challenge_id))
    except (ValueError, TypeError):
        challenge_id = None
    phone = Challenge.objects.filter(pk=challenge_id).values_list('phone', flat=True).first() if challenge_id else None
    reserve_limits('verify', phone or 'unknown', ip)
    result, error = None, None
    with transaction.atomic():
        if phone:
            PhoneIdentity.objects.select_for_update().filter(pk=phone).first()
        c = Challenge.objects.select_for_update().filter(pk=challenge_id).first() if challenge_id else None
        if not c or c.consumed or not c.sent or c.expires_at <= timezone.now() or c.attempts >= 5:
            error = APIError('invalid_verification', 400)
        else:
            c.attempts += 1
            try:
                approved = bool(isinstance(code, str) and re.fullmatch(r'\d{6}', code) and provider(c.provider).check(c, code))
            except ProviderUnavailable:
                approved = False
                error = APIError('provider_unavailable', 503)
            if approved:
                c.consumed = True
                c.development_code = ''
                account, _ = Account.objects.get_or_create(phone=c.phone)
                result = issue_session(account, device_name)
            else:
                error = error or APIError('invalid_verification', 400)
            c.save()
    if error:
        raise error
    return result


def authenticate(request):
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer ') or len(auth) > 200:
        raise APIError('unauthorized', 401)
    session = DeviceSession.objects.select_related('account').filter(
        pk=digest(auth[7:]), revoked_at__isnull=True, expires_at__gt=timezone.now()).first()
    if not session:
        raise APIError('unauthorized', 401)
    return session


def issue_session(account, device_name, identity=None, *, token=None):
    token = token or secrets.token_urlsafe(32)
    expires = timezone.now() + timedelta(days=30)
    DeviceSession.objects.create(token_hash=digest(token), account=account,
                                 device_name=str(device_name or 'Wipster')[:100], expires_at=expires)
    return {'token': token, 'account_id': str(account.id), 'phone': account.phone,
            'email': identity.email if identity else '', 'name': identity.name if identity else '',
            'google_linked': account.identities.filter(issuer='https://accounts.google.com').exists(),
            'yandex_linked': account.identities.filter(issuer='https://login.yandex.ru').exists(),
            'expires_at': expires.isoformat()}
