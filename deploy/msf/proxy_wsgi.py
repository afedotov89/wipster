"""Deployment boundary: only the private Wipster gateway reaches the API.

Both ingress hops replace X-Real-IP, X-Forwarded-For and X-Forwarded-Proto.
Django's durable per-IP quotas must see that single validated address, not the
Docker gateway address. This wrapper is mounted read-only in production only.
"""
import ipaddress
from project.wsgi import application as django_application


def application(environ, start_response):
    try:
        address = str(ipaddress.ip_address(environ.get('HTTP_X_REAL_IP', '')))
    except ValueError:
        start_response('400 Bad Request', [('Content-Type', 'text/plain')])
        return [b'Invalid ingress address']
    environ['REMOTE_ADDR'] = address
    return django_application(environ, start_response)
