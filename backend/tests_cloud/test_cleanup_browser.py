import io
import threading
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.db import close_old_connections, transaction
from django.utils import timezone
from apps.accounts.models import Account, ExternalIdentity, DeviceSession, WebBrowser, YandexAttempt
from apps.accounts.management.commands.cleanup_yandex_attempts import delete_expired_browser_batch

pytestmark = pytest.mark.django_db(transaction=True)


def browser(key, expires, **values):
    return WebBrowser.objects.create(credential_hash=key*64, expires_at=expires, **values)


def test_expiry_only_cleanup_preserves_parents_live_bindings_and_output():
    now = timezone.now(); account = Account.objects.create()
    identity = ExternalIdentity.objects.create(account=account, issuer='https://login.yandex.ru', subject='cleanup')
    sessions = [DeviceSession.objects.create(token_hash=key*64, account=account, channel=channel,
                device_name=channel, expires_at=now+timedelta(days=10)) for key,channel in [('n','native'),('w','web')]]
    attempt = YandexAttempt.objects.create(proof_hash='proof', state='s'*43, device_name='active',
                    result_session=sessions[1], expires_at=now+timedelta(minutes=5))
    expired_attempt = YandexAttempt.objects.create(proof_hash='proof', state='e'*43, device_name='expired', expires_at=now-timedelta(seconds=1))
    expired = browser('x',now-timedelta(days=1),device=sessions[1],pending_attempt=attempt)
    active = browser('a',now+timedelta(days=1),device=sessions[0],pending_attempt=expired_attempt)
    renewed = browser('r',now-timedelta(days=1),device=sessions[1])
    WebBrowser.objects.filter(pk=renewed.pk).update(expires_at=now+timedelta(days=2))
    session_rows=list(DeviceSession.objects.order_by('pk').values()); identities=list(ExternalIdentity.objects.values()); accounts=list(Account.objects.values())
    output=io.StringIO();call_command('cleanup_yandex_attempts',stdout=output)
    assert output.getvalue()=='Deleted 1 expired Yandex attempts\nDeleted 1 expired web browser bindings\n'
    assert not WebBrowser.objects.filter(pk=expired.pk).exists()
    assert set(WebBrowser.objects.values_list('pk',flat=True))=={active.pk,renewed.pk}
    active.refresh_from_db();assert active.pending_attempt_id is None and active.device_id==sessions[0].pk
    assert YandexAttempt.objects.filter(pk=attempt.pk,result_session=sessions[1]).exists()
    assert not YandexAttempt.objects.filter(pk=expired_attempt.pk).exists()
    assert list(DeviceSession.objects.order_by('pk').values())==session_rows
    assert list(Account.objects.values())==accounts and list(ExternalIdentity.objects.values())==identities
    output=io.StringIO();call_command('cleanup_yandex_attempts',stdout=output)
    assert output.getvalue()=='Deleted 0 expired Yandex attempts\nDeleted 0 expired web browser bindings\n'


def test_cleanup_is_bounded_and_repeated_calls_are_safe():
    now=timezone.now()
    for i in range(5):browser(str(i),now-timedelta(seconds=i+1))
    call_command('cleanup_yandex_attempts',browser_batch_size=2,browser_max_batches=1)
    assert WebBrowser.objects.count()==3
    call_command('cleanup_yandex_attempts',browser_batch_size=2,browser_max_batches=1)
    assert WebBrowser.objects.count()==1
    call_command('cleanup_yandex_attempts',browser_batch_size=2,browser_max_batches=1)
    assert WebBrowser.objects.count()==0
    call_command('cleanup_yandex_attempts',browser_batch_size=2,browser_max_batches=1)


def test_renewal_holding_row_lock_is_skipped_then_preserved():
    now=timezone.now(); renewed=browser('r',now-timedelta(days=1)); expired=browser('e',now-timedelta(days=1))
    locked=threading.Event();release=threading.Event();errors=[]
    def renew():
        close_old_connections()
        try:
            with transaction.atomic():
                row=WebBrowser.objects.select_for_update().get(pk=renewed.pk)
                row.expires_at=now+timedelta(days=1);row.save(update_fields=['expires_at'])
                locked.set();assert release.wait(5)
        except BaseException as error:errors.append(error);locked.set()
        finally:close_old_connections()
    worker=threading.Thread(target=renew);worker.start()
    try:
        assert locked.wait(5)
        assert delete_expired_browser_batch(now,2)==1
        assert not WebBrowser.objects.filter(pk=expired.pk).exists()
    finally:
        release.set();worker.join(5)
    assert not worker.is_alive() and not errors
    assert delete_expired_browser_batch(now,2)==0
    assert WebBrowser.objects.get(pk=renewed.pk).expires_at>now
