import uuid
from django.db import models


class Account(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=16, unique=True, null=True, blank=True)
    sequence = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)


class DeviceSession(models.Model):
    channel = models.CharField(max_length=8, default="native")
    token_hash = models.CharField(max_length=64, primary_key=True)
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='devices')
    device_name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    revoked_at = models.DateTimeField(null=True)


class Challenge(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=16)
    code_hash = models.CharField(max_length=64, blank=True)
    # Never populated by the production provider. Local command only, not HTTP.
    development_code = models.CharField(max_length=6, blank=True)
    provider = models.CharField(max_length=20)
    provider_id = models.CharField(max_length=64, blank=True)
    expires_at = models.DateTimeField(db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed = models.BooleanField(default=False)
    sent = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=['phone', 'consumed'], name='challenge_phone_active')]


class RateBucket(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(db_index=True)


class PhoneIdentity(models.Model):
    # Serializes resend/verification across challenge IDs, before an account exists.
    phone = models.CharField(max_length=16, primary_key=True)


class ExternalIdentity(models.Model):
    issuer = models.CharField(max_length=100)
    subject = models.CharField(max_length=255)
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='identities')
    # Display metadata only, never used to resolve or merge accounts.
    email = models.EmailField(blank=True)
    name = models.CharField(max_length=200, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['issuer', 'subject'], name='external_issuer_subject')]


class GoogleAttempt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    proof_hash = models.CharField(max_length=64)
    state = models.CharField(max_length=64)
    nonce = models.CharField(max_length=64)
    challenge = models.CharField(max_length=43)
    redirect_uri = models.CharField(max_length=100)
    # Links are tied to this exact device session, never to a supplied account ID.
    link_session = models.ForeignKey(DeviceSession, null=True, on_delete=models.CASCADE)
    expires_at = models.DateTimeField(db_index=True)
    consumed = models.BooleanField(default=False)
    cancelled = models.BooleanField(default=False)


class YandexAttempt(models.Model):
    """Durable browser/native rendezvous. Provider credentials are never retained."""
    channel = models.CharField(max_length=8, default="native")
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    proof_hash = models.CharField(max_length=64)
    state = models.CharField(max_length=43, unique=True)
    verifier = models.CharField(max_length=128, blank=True)
    link_session = models.ForeignKey(DeviceSession, null=True, on_delete=models.CASCADE, related_name='+')
    result_session = models.ForeignKey(DeviceSession, null=True, on_delete=models.CASCADE, related_name='+')
    device_name = models.CharField(max_length=100)
    expires_at = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=16, default='pending')
    subject = models.CharField(max_length=255, blank=True)
    email = models.EmailField(blank=True)
    name = models.CharField(max_length=200, blank=True)


class WebBrowser(models.Model):
    """Stable HttpOnly browser binding; auth mutations never replace its cookie."""
    credential_hash = models.CharField(max_length=64, primary_key=True)
    public_id = models.UUIDField(default=uuid.uuid4, unique=True)
    generation = models.PositiveBigIntegerField(default=0)
    pending_attempt = models.ForeignKey(YandexAttempt, null=True, on_delete=models.SET_NULL)
    device = models.ForeignKey(DeviceSession, null=True, on_delete=models.SET_NULL)
    expires_at = models.DateTimeField(db_index=True)
