import os
os.environ.setdefault('DEBUG', 'true')
os.environ.setdefault('DEV_OTP_ENABLED', 'true')
os.environ.setdefault('OTP_PROVIDER', 'development')

import pytest
@pytest.fixture(autouse=True)
def development_settings(settings):
    settings.DEBUG = True
    settings.DEV_OTP_ENABLED = True
    settings.OTP_PROVIDER = 'development'
