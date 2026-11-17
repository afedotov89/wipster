import json
import pytest
from django.test import Client


@pytest.mark.django_db(transaction=True)
def test_static_whitelist_route_precedence_mime_and_cache(tmp_path,settings):
    settings.PWA_ROOT=str(tmp_path)
    settings.YANDEX_ENABLED=True
    settings.YANDEX_CLIENT_ID='a'*32
    (tmp_path/'assets').mkdir(); (tmp_path/'icons').mkdir()
    for name,data in [('index.html','<h1>shell</h1>'),('sw.js','// shell only'),('manifest.webmanifest','{}'),('assets/app-abc.js','const a=1')]:
        (tmp_path/name).write_text(data)
    (tmp_path/'pwa-build.json').write_text(json.dumps({'files':['/index.html','/manifest.webmanifest','/assets/app-abc.js']}))
    c=Client()
    for route,mime in [('/','text/html'),('/manifest.webmanifest','application/manifest+json'),('/sw.js','text/javascript'),('/assets/app-abc.js','text/javascript')]:
        r=c.get(route);assert r.status_code==200 and r['Content-Type'].startswith(mime)
        assert r['Cache-Control']==('public, max-age=31536000, immutable' if route.startswith('/assets/') else 'no-cache')
        assert "frame-ancestors 'none'" in r['Content-Security-Policy']
        r.close()
    for route in ['/api/unknown','/api/v1/unknown','/icons/unknown.png','/unknown-page','/assets/../../requirements.lock','/?code=sensitive']:
        assert c.get(route).status_code==404
    assert c.get('/api/v1/auth/yandex/callback').status_code==400
    assert c.get('/healthz').json()=={'status':'ok'}
    assert c.get('/api/v1/web/session')['Cache-Control']=='no-store'
