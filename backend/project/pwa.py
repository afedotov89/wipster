"""Allowlisted immutable PWA files. API/health/callback never reach this view.

PWA_ROOT is a build-time image directory, not a writable upload location. The
build manifest bounds the whitelist; unknown routes/assets return real 404s.
"""
import json
from pathlib import Path
from django.conf import settings
from django.http import FileResponse, HttpResponseNotFound
from django.urls import path, re_path

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; "
       "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json'}


def serve(request, asset='index.html'):
    root = Path(settings.PWA_ROOT).resolve() if settings.PWA_ROOT else None
    if request.method not in ('GET', 'HEAD') or not root or request.GET:
        return HttpResponseNotFound()
    try:
        manifest = json.loads((root / 'pwa-build.json').read_text())
        allowed = set(manifest['files']) | {'/sw.js'}
        file = (root / asset).resolve()
        if '/' + asset not in allowed or not file.is_relative_to(root) or not file.is_file():
            return HttpResponseNotFound()
        response = FileResponse(file.open('rb'), content_type=MIME.get(file.suffix, 'application/octet-stream'))
    except (OSError, ValueError, KeyError, TypeError):
        return HttpResponseNotFound()
    response['Cache-Control'] = 'public, max-age=31536000, immutable' if asset.startswith('assets/') else 'no-cache'
    response['Content-Security-Policy'] = CSP
    response['X-Content-Type-Options'] = 'nosniff'
    response['Referrer-Policy'] = 'no-referrer'
    response['X-Frame-Options'] = 'DENY'
    if asset == 'sw.js':
        response['Service-Worker-Allowed'] = '/'
    return response


urlpatterns = [path('', serve), path('index.html', serve),
               re_path(r'^(?P<asset>(?:assets|icons)/[^/]+|sw\.js|manifest\.webmanifest)$', serve)]
