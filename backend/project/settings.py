from pathlib import Path
import re
import environ
from django.core.exceptions import ImproperlyConfigured

env = environ.Env(DEBUG=(bool, False))
BASE_DIR = Path(__file__).resolve().parent.parent
# Configuration is explicit: do not silently load a developer's .env in production.
DEBUG = env('DEBUG')
SECRET_KEY = env('SECRET_KEY', default='development-only-unsafe-key')
DATABASES = {'default': env.db('DATABASE_URL', default=f'sqlite:///{BASE_DIR / "db.sqlite3"}')}
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['localhost', '127.0.0.1', 'testserver'])
OTP_PROVIDER = env('OTP_PROVIDER', default='disabled')
DEV_OTP_ENABLED = env.bool('DEV_OTP_ENABLED', default=False)
GOOGLE_ENABLED = env.bool('GOOGLE_ENABLED', default=False)
GOOGLE_CLIENT_ID = env('GOOGLE_CLIENT_ID', default='')
# Desktop clients are public; optional downloaded client secret stays server-only.
GOOGLE_CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET', default='')
if GOOGLE_ENABLED and not re.fullmatch(r'[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', GOOGLE_CLIENT_ID):
    raise ImproperlyConfigured('Google requires a configured Desktop OAuth client ID')
YANDEX_ENABLED = env.bool('YANDEX_ENABLED', default=False)
YANDEX_CLIENT_ID = env('YANDEX_CLIENT_ID', default='')
# PKCE supports omitting the secret. Never send this value to native/frontend.
YANDEX_CLIENT_SECRET = env('YANDEX_CLIENT_SECRET', default='')
if YANDEX_ENABLED and not re.fullmatch(r'[a-f0-9]{32}', YANDEX_CLIENT_ID):
    raise ImproperlyConfigured('Yandex requires a configured authorization app client ID')
TWILIO_ACCOUNT_SID = env('TWILIO_ACCOUNT_SID', default='')
TWILIO_AUTH_TOKEN = env('TWILIO_AUTH_TOKEN', default='')
TWILIO_VERIFY_SERVICE_SID = env('TWILIO_VERIFY_SERVICE_SID', default='')
if OTP_PROVIDER not in ('disabled', 'development', 'twilio'):
    raise ImproperlyConfigured('Unknown OTP_PROVIDER')
if OTP_PROVIDER == 'development' and not (DEBUG and DEV_OTP_ENABLED):
    raise ImproperlyConfigured('Development OTP requires DEBUG and DEV_OTP_ENABLED')
if OTP_PROVIDER == 'twilio' and not all((TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID)):
    raise ImproperlyConfigured('Twilio Verify requires all credentials')
if not DEBUG:
    if len(SECRET_KEY) < 50 or SECRET_KEY.startswith(('development', 'django-insecure')):
        raise ImproperlyConfigured('Production requires a strong SECRET_KEY (50+ characters)')
    if DATABASES['default']['ENGINE'] != 'django.db.backends.postgresql':
        raise ImproperlyConfigured('Production requires PostgreSQL')
    if not YANDEX_ENABLED and not GOOGLE_ENABLED and OTP_PROVIDER != 'twilio':
        raise ImproperlyConfigured('Production requires configured Yandex ID, Google or Twilio Verify')
    if DEV_OTP_ENABLED or '*' in ALLOWED_HOSTS or 'testserver' in ALLOWED_HOSTS:
        raise ImproperlyConfigured('Unsafe production configuration')
INSTALLED_APPS = ['django.contrib.contenttypes', 'corsheaders', 'apps.accounts', 'apps.sync']
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'corsheaders.middleware.CorsMiddleware',
              'django.middleware.common.CommonMiddleware']
ROOT_URLCONF = 'project.urls'
WSGI_APPLICATION = 'project.wsgi.application'
ASGI_APPLICATION = 'project.asgi.application'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
USE_TZ = True
TIME_ZONE = 'UTC'
CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS', default=[])
CORS_ALLOW_CREDENTIALS = False
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = 31536000 if not DEBUG else 0
SECURE_CONTENT_TYPE_NOSNIFF = True
# Set ONLY behind an ingress that strips client-supplied X-Forwarded-Proto.
if env.bool('TRUST_PROXY_TLS', default=False):
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
DATA_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024
LOGGING = {'version': 1, 'disable_existing_loggers': False,
           'handlers': {'console': {'class': 'logging.StreamHandler'}},
           'root': {'handlers': ['console'], 'level': 'WARNING'}}
