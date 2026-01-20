import os
from pathlib import Path
import environ

# Initialize environ
env = environ.Env(
    # set default values for environment variables
    DEBUG=(bool, False),
    SECRET_KEY=(str, 'django-insecure-default-key'),
    ALLOWED_HOSTS=(list, ['localhost', '127.0.0.1']),
    CORS_ALLOWED_ORIGINS=(list, ['http://localhost:3000', 'http://127.0.0.1:3000']),
    STATIC_URL=(str, None),
    SITE_URL=(str, None),
)

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Take environment variables from .env file
environ.Env.read_env(os.path.join(BASE_DIR, '.env'))

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = env('SECRET_KEY')

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env('DEBUG')

# Set site URL based on environment or use default based on DEBUG
SITE_URL = env('SITE_URL')

ALLOWED_HOSTS = env('ALLOWED_HOSTS')

# Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.sites', # Required by allauth

    # Third-party apps
    'rest_framework',
    'corsheaders',
    'allauth',
    'allauth.account',
    'allauth.socialaccount',
    'allauth.socialaccount.providers.google',
    'dj_rest_auth',
    'dj_rest_auth.registration',

    # Local apps
    'apps.api',
]

SITE_ID = 1 # Required by allauth

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'allauth.account.middleware.AccountMiddleware', # Add allauth middleware
]

ROOT_URLCONF = 'project.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'project.wsgi.application'

# Database
# https://docs.djangoproject.com/en/4.2/ref/settings/#databases

# Use DATABASE_URL environment variable for database configuration
DATABASES = {
    'default': env.db('DATABASE_URL', default='sqlite:///db.sqlite3')
}

# Password validation
# https://docs.djangoproject.com/en/4.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# Internationalization
# https://docs.djangoproject.com/en/4.2/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True

# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/4.2/howto/static-files/

# Default STATIC_URL for development
STATIC_URL_DEFAULT = 'static/'

# STATIC_URL for production, expecting to be served under /api/static/ via API Gateway
# Can be overridden by environment variable if needed for specific setups
STATIC_URL_PRODUCTION_DEFAULT = '/api/static/'

# Set STATIC_URL based on DEBUG status, allowing override via environment variable
STATIC_URL = env('STATIC_URL', default=STATIC_URL_PRODUCTION_DEFAULT if not DEBUG else STATIC_URL_DEFAULT)

STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')

# Default primary key field type
# https://docs.djangoproject.com/en/4.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# CORS settings
CORS_ALLOWED_ORIGINS = env('CORS_ALLOWED_ORIGINS')
CORS_ALLOW_CREDENTIALS = True # Allow cookies to be sent cross-origin

# Дополнительные настройки CORS для решения проблем с API Gateway
CORS_ALLOW_METHODS = [
    'DELETE',
    'GET',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
]

CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
]

# CSRF settings
CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=CORS_ALLOWED_ORIGINS) # Trust CORS origins by default
CSRF_ENSURE_COOKIE_ON_GET = True # Ensure CSRF cookie is sent on GET requests for SPAs
CSRF_COOKIE_HTTPONLY = False # Ensure CSRF cookie is readable by JavaScript (default is False, but being explicit)

# Cookie settings for cross-origin auth
SESSION_COOKIE_SAMESITE = 'None'  # Required for cross-origin cookies
CSRF_COOKIE_SAMESITE = 'None'     # Required for cross-origin CSRF protection
# When SameSite=None, the Secure flag MUST be set to True, even in development
SESSION_COOKIE_SECURE = True  # Required when SameSite is 'None'
CSRF_COOKIE_SECURE = True     # Required when SameSite is 'None'

# REST Framework settings
REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated', # Require authentication by default
    ],
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
        # BasicAuthentication removed as SessionAuthentication is primary
        # 'rest_framework.authentication.BasicAuthentication',
    ],
}

# Authentication settings
AUTHENTICATION_BACKENDS = [
    # Needed to login by username in Django admin, regardless of `allauth`
    'django.contrib.auth.backends.ModelBackend',

    # `allauth` specific authentication methods, such as login by e-mail
    'allauth.account.auth_backends.AuthenticationBackend',
]

# django-allauth settings
ACCOUNT_AUTHENTICATION_METHOD = 'email' # Use email for login
ACCOUNT_EMAIL_REQUIRED = True
ACCOUNT_UNIQUE_EMAIL = True
ACCOUNT_USERNAME_REQUIRED = False # Don't require username if logging in with email
ACCOUNT_EMAIL_VERIFICATION = 'optional' # Or 'mandatory' or 'none'
EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend' # For testing email sending

# dj-rest-auth settings
REST_AUTH = {
    'USE_JWT': False, # Use session authentication
    'SESSION_LOGIN': True, # Use Django sessions for login
    'TOKEN_MODEL': None, # Explicitly disable token model since we use sessions
    'USER_DETAILS_SERIALIZER': 'apps.api.serializers.UserDetailsSerializer',
    # 'REGISTER_SERIALIZER': 'dj_rest_auth.registration.serializers.RegisterSerializer', # Let dj-rest-auth handle default with allauth
}

# Provider specific settings
SOCIALACCOUNT_PROVIDERS = {
    'google': {
        'APP': {
            'client_id': os.environ.get('GOOGLE_CLIENT_ID', ''),
            'secret': os.environ.get('GOOGLE_CLIENT_SECRET', ''),
            'key': ''
        },
        'SCOPE': [
            'profile',
            'email',
            'openid',  # Добавляем openid для работы с ID tokens
        ],
        'AUTH_PARAMS': {
            'access_type': 'online',
        },
        # Используем PKCE для повышения безопасности
        'OAUTH_PKCE_ENABLED': True,
        # Принимаем идентификационные данные напрямую из фронтенда
        'VERIFIED_EMAIL': True,
    }
}

# Дополнительные настройки для решения проблем с Cross-Origin-Opener-Policy
SECURE_CROSS_ORIGIN_OPENER_POLICY = None # Отключаем COOP для решения проблем с окнами авторизации

# Настройки для правильной работы OAuth
ACCOUNT_DEFAULT_HTTP_PROTOCOL = 'https'

# Настройки для перенаправления после входа/выхода
LOGIN_REDIRECT_URL = '/'
LOGOUT_REDIRECT_URL = '/'

# Добавляем логирование для отладки OAuth
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django.request': {
            'handlers': ['console'],
            'level': 'DEBUG',
            'propagate': False,
        },
        'allauth': {
            'handlers': ['console'],
            'level': 'DEBUG',
        },
        'dj_rest_auth': {
            'handlers': ['console'],
            'level': 'DEBUG',
        },
    },
}
