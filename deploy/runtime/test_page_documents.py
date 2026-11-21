"""Exercise the page log allowlist, actual Nginx responses, and hourly roll-up."""

from contextlib import contextmanager
from datetime import datetime
import http.client
from io import BytesIO
import json
import os
from pathlib import Path
import runpy
import shutil
import socket
import subprocess
import tempfile
import time
import unittest


HERE = Path(__file__).resolve().parent
AGGREGATE = runpy.run_path(str(HERE/'production/aggregate-page-documents.py'))
SLOTS = runpy.run_path(str(HERE/'production/release-slots.py'))
NGINX = shutil.which('nginx')


def record(instant, locale, page_type, cache):
    value = {'kind': 'page_document_v1', 'time': instant,
             'locale': locale, 'pageType': page_type, 'cache': cache}
    return json.dumps(value, separators=(',', ':')).encode() + b'\n'


class PageDocumentHours(unittest.TestCase):
    def test_beijing_midnight_and_repeatable_replacement(self):
        hour = AGGREGATE['beijing_hour']('2026-01-11T16:00:00Z')
        start = hour.timestamp()
        lines = (record(start-.001, 'ru', 'vehicle', 'cold')
                 + record(start, 'en', 'home', 'hot')
                 + b'{"family":"ssr","status":200,"request_seconds":0.001}\n'
                 + record(start+1, 'en', 'home', 'cold')
                 + record(start+3599.999, 'zh', 'catalog', 'cold')
                 + record(start+3600, 'ru', 'vehicle', 'cold'))
        expected = {'version': 1, 'hour': '2026-01-12T00:00:00+08:00', 'status': 'complete', 'rows': [
            {'locale': 'en', 'pageType': 'home', 'requests': 2},
            {'locale': 'zh', 'pageType': 'catalog', 'requests': 1},
        ]}
        for _ in range(2):
            self.assertEqual(AGGREGATE['aggregate'](BytesIO(lines), hour, 'complete'), expected)

    def test_open_hour_can_only_be_partial(self):
        hour = datetime.now(AGGREGATE['BEIJING']).replace(minute=0, second=0, microsecond=0)
        lines = BytesIO(record(hour.timestamp(), 'en', 'home', 'hot'))
        with self.assertRaises(ValueError):
            AGGREGATE['aggregate'](lines, hour, 'complete')
        self.assertEqual(AGGREGATE['aggregate'](lines, hour, 'partial')['status'], 'partial')

    def test_malformed_or_overbroad_page_log_fails(self):
        hour = AGGREGATE['beijing_hour']('2026-01-12T00:00:00+08:00')
        start = hour.timestamp()
        for invalid in (record(start, 'raw', 'home', 'hot'), record(start, 'en', '/raw', 'hot'),
                        record(start, 'en', 'home', 'hot')[:-1],
                        record(start, 'en', 'home', 'hot').replace(b'}', b',"ip":"private"}')):
            with self.subTest(raw=invalid), self.assertRaises(ValueError):
                AGGREGATE['aggregate'](BytesIO(invalid), hour, 'complete')
        with self.assertRaises(ValueError):
            AGGREGATE['beijing_hour']('2026-01-12T00:01:00+08:00')

    def test_switch_targets_public_tls_and_only_the_coverage_probe(self):
        args = dict(web_host='web-blue', public_api_host='api-blue', admin_api_host='api-blue')
        default = SLOTS['gateway_files'](HERE, **args)['default.conf']
        enabled = SLOTS['gateway_files'](HERE, **args, page_documents=True)['default.conf']
        self.assertEqual(default.count('set $hd_page_documents_enabled 0;'), 2)
        self.assertEqual(enabled, default.replace('set $hd_page_documents_enabled 0;',
                                                  'set $hd_page_documents_enabled 1;'))
        self.assertIn('listen 8443 ssl;\n    server_name cars.hongdingauto.com;\n'
                      '    set $hd_page_documents_enabled 1;', enabled)
        self.assertIn('location = /health/proxy {\n        set $hd_page_documents_enabled 1;\n'
                      '        access_log /dev/stdout hd_page_document_coverage', enabled)


@contextmanager
def gateway(enabled):
    with tempfile.TemporaryDirectory(prefix='hd-page-docs-') as work:
        root = Path(work).resolve()
        mapping = (HERE/'nginx-domains/page-documents.conf').read_text()
        # The test uses an in-process Nginx upstream on a private Unix socket.
        mapping = mapping.replace('):3010:hit$', '):hit$')
        edge = (HERE/'nginx-edge.conf').read_text().replace('/etc/nginx/hd-analytics-geo/country.conf',
                                                str(HERE/'production/analytics-geo-disabled.conf'))
        if os.uname().sysname == 'Darwin':
            edge = edge.replace('zone=hd_edge_total:64k', 'zone=hd_edge_total:256k')
        proxy = (HERE/'nginx-domains/web-proxy.conf').read_text()
        config = root/'nginx.conf'
        root_user = 'user root;\n' if os.getuid() == 0 else ''
        config.write_text(root_user+f'''pid {root}/nginx.pid;
events {{ worker_connections 64; }}
http {{
    client_body_temp_path {root}/body;
    proxy_temp_path {root}/proxy;
    {edge}
    {mapping}
    upstream html-cache-blue {{ server unix:{root}/origin.sock; }}
    upstream dynamic {{ server unix:{root}/origin.sock; }}
    server {{
        listen unix:{root}/proxy.sock;
        server_name cars.hongdingauto.com;
        set $hd_page_documents_enabled {int(enabled)};
        access_log {root}/access.log hd_page_document if=$hd_page_document_selected;
        location = /en/ {{ set $web http://html-cache-blue; {proxy} }}
        location / {{ set $web http://dynamic; {proxy} }}
    }}
    server {{ listen unix:{root}/proxy.sock; server_name admin.hongdingauto.com; return 200 'admin'; }}
    server {{
        listen unix:{root}/origin.sock;
        access_log off;
        default_type 'text/html; charset=utf-8';
        add_header X-HD-Cache-Document hit always;
        location = /zh/cars/redirect/ {{ return 302 /zh/cars/; }}
        location = /zh/cars/unavailable/ {{ return 503; }}
        location = /zh/cars/missing/ {{ return 404; }}
        location = /zh/cars/rsc/ {{ default_type text/x-component; return 200 'component'; }}
        location / {{ return 200 'safe document'; }}
    }}
}}
''')
        command = [NGINX, '-p', str(root)+'/', '-c', str(config), '-e', str(root/'bootstrap.log')]
        checked = subprocess.run([*command, '-t'], capture_output=True, text=True, timeout=5)
        if checked.returncode:
            raise RuntimeError(checked.stderr)
        with subprocess.Popen([*command, '-g', 'daemon off;'], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL) as process:
            try:
                deadline = time.monotonic()+3
                while not (root/'proxy.sock').is_socket():
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError('Fixture gateway did not start')
                    time.sleep(.025)
                yield root
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)


def request(root, path, *, method='GET', headers=None, host='cars.hongdingauto.com'):
    request_headers = {'Host': host, 'User-Agent': 'FixtureBrowser', 'Connection': 'close',
                       'Sec-Fetch-Dest': 'document', **(headers or {})}
    wire = (f'{method} {path} HTTP/1.1\r\n'
            + ''.join(f'{name}: {value}\r\n' for name, value in request_headers.items()) + '\r\n')
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(5)
        connection.connect(str(root/'proxy.sock'))
        connection.sendall(wire.encode('ascii'))
        response = http.client.HTTPResponse(connection, method=method)
        response.begin()
        response.read()
        return response.status, response.getheader('X-HD-Cache-Document')


@unittest.skipUnless(NGINX, 'native nginx is required')
class PageDocumentGateway(unittest.TestCase):
    def test_only_completed_public_html_and_no_request_identifiers(self):
        with gateway(True) as root:
            for path, headers in (
                ('/zh/cars/?query=privateSearch', {'Referer': 'https://private.example/article',
                  'User-Agent': 'PrivateBrowser', 'X-Forwarded-For': '203.0.113.7'}),
                ('/en/', {}), ('/ru/cars/private-slug/', {}),
            ):
                self.assertEqual(request(root, path, headers=headers), (200, None))
            for path, headers, method, host, status in (
                ('/zh/cars/', {'User-Agent': 'Googlebot'}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/', {'Purpose': 'prefetch'}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/', {'RSC': '1'}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/', {'Next-Router-Segment-Prefetch': '/x'}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/', {'Sec-Fetch-Dest': 'empty'}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/?_rsc=a', {}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/rsc/', {}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/missing/', {}, 'GET', 'cars.hongdingauto.com', 404),
                ('/zh/cars/unavailable/', {}, 'GET', 'cars.hongdingauto.com', 503),
                ('/zh/cars/redirect/', {}, 'GET', 'cars.hongdingauto.com', 302),
                ('/zh/cars/', {}, 'HEAD', 'cars.hongdingauto.com', 200),
                ('/_next/static/f.js', {}, 'GET', 'cars.hongdingauto.com', 200),
                ('/internal/private/', {}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/', {}, 'GET', 'admin.hongdingauto.com', 200),
            ):
                self.assertEqual(request(root, path, headers=headers, method=method, host=host), (status, None))
            raw = (root/'access.log').read_text()
            for value in ('privateSearch', 'private.example', 'PrivateBrowser', '203.0.113.7', 'private-slug'):
                self.assertNotIn(value, raw)
            rows = [json.loads(line) for line in raw.splitlines()]
            self.assertEqual([(row['locale'], row['pageType'], row['cache']) for row in rows],
                             [('zh', 'catalog', 'cold'), ('en', 'home', 'hot'), ('ru', 'vehicle', 'cold')])
            self.assertTrue(all(row.keys() == AGGREGATE['FIELDS'] for row in rows))

    def test_default_off_still_serves_documents(self):
        with gateway(False) as root:
            self.assertEqual(request(root, '/zh/'), (200, None))
            self.assertEqual((root/'access.log').read_text(), '')


if __name__ == '__main__':
    unittest.main()
