from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from apps.accounts.models import Challenge


class Command(BaseCommand):
    help = 'Read one local development OTP; never available in production or over HTTP.'

    def add_arguments(self, parser):
        parser.add_argument('challenge_id')

    def handle(self, *args, **options):
        if not (settings.DEBUG and settings.DEV_OTP_ENABLED and settings.OTP_PROVIDER == 'development'):
            raise CommandError('Development OTP is disabled')
        c = Challenge.objects.filter(pk=options['challenge_id'], consumed=False, sent=True,
                                     expires_at__gt=timezone.now(), provider='development').first()
        if not c:
            raise CommandError('No active development challenge')
        self.stdout.write(c.development_code)
