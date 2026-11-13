from django.core.management.base import BaseCommand
from django.utils import timezone
from apps.accounts.models import YandexAttempt


class Command(BaseCommand):
    help = 'Delete expired Yandex handshakes only; device sessions and identities stay intact.'

    def handle(self, *args, **options):
        count, _ = YandexAttempt.objects.filter(expires_at__lte=timezone.now()).delete()
        self.stdout.write(f'Deleted {count} expired Yandex attempts')
