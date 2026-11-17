from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from apps.accounts.models import YandexAttempt, WebBrowser


def delete_expired_browser_batch(cutoff, batch_size):
    """Lock and recheck expiry in one small transaction; never delete parents.

    A renewal that already committed fails the expiry predicate. Concurrent
    renewals holding a row lock are skipped; once selected, deletion/renewal are
    ordered by this row lock. The second expiry predicate also fences selection.
    """
    with transaction.atomic():
        ids = list(WebBrowser.objects.filter(expires_at__lte=cutoff)
                   .select_for_update(skip_locked=True).order_by('expires_at', 'pk')
                   .values_list('pk', flat=True)[:batch_size])
        count, _ = WebBrowser.objects.filter(pk__in=ids, expires_at__lte=cutoff).delete()
    return count


class Command(BaseCommand):
    help = 'Delete expired Yandex handshakes and bounded expired browser bindings; sessions and identities stay intact.'

    def add_arguments(self, parser):
        parser.add_argument('--browser-batch-size', type=int, default=200)
        parser.add_argument('--browser-max-batches', type=int, default=20)

    def handle(self, *args, **options):
        batch_size, max_batches = options['browser_batch_size'], options['browser_max_batches']
        if not 1 <= batch_size <= 1000 or not 1 <= max_batches <= 100:
            raise CommandError('Browser cleanup bounds: batch-size1..1000, max-batches1..100')
        cutoff = timezone.now()
        count, _ = YandexAttempt.objects.filter(expires_at__lte=cutoff).delete()
        # Preserve the existing maintenance output line; the installed script
        # already invokes this command and needs no timer/ops change.
        self.stdout.write(f'Deleted {count} expired Yandex attempts')
        deleted = 0
        for _ in range(max_batches):
            count = delete_expired_browser_batch(cutoff, batch_size)
            deleted += count
            if count < batch_size:
                break
        self.stdout.write(f'Deleted {deleted} expired web browser bindings')
