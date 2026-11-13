from django.db import models
from apps.accounts.models import Account


class Entity(models.Model):
    account = models.ForeignKey(Account, on_delete=models.CASCADE)
    kind = models.CharField(max_length=20)
    entity_id = models.CharField(max_length=160)
    version = models.PositiveBigIntegerField()
    data = models.JSONField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['account', 'kind', 'entity_id'], name='entity_identity')]


class Change(models.Model):
    account = models.ForeignKey(Account, on_delete=models.CASCADE)
    sequence = models.PositiveBigIntegerField()
    kind = models.CharField(max_length=20)
    entity_id = models.CharField(max_length=160)
    version = models.PositiveBigIntegerField()
    data = models.JSONField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['account', 'sequence'], name='account_sequence')]
        ordering = ['sequence']


class Receipt(models.Model):
    account = models.ForeignKey(Account, on_delete=models.CASCADE)
    batch_id = models.UUIDField()
    body_hash = models.CharField(max_length=64)
    response = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['account', 'batch_id'], name='batch_identity')]
