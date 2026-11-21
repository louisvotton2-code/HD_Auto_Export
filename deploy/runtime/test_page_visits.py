"""Check the live Nginx visit selector and the private lossy datagram boundary."""

from contextlib import contextmanager
import http.client
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import socket
import subprocess
import tempfile
import time
import unittest


HERE = Path(__file__).resolve().parent
NGINX = shutil.which('nginx')
SLOTS = runpy.run_path(str(HERE/'production/release-slots.py'))
SYSLOG_PREFIX = rb'<190>[A-Z][a-z]{2} [ 0-9][0-9] [0-9:]{8} hd_visit: '
MSEC = rb'[0-9]{10}[.][0-9]{3}'
VISIT = re.compile(SYSLOG_PREFIX + rb'v1 visit ' + MSEC + rb' 127[.]0[.]0[.]1')
COVERAGE = re.compile(SYSLOG_PREFIX + rb'v1 coverage ' + MSEC)


class VisitConfiguration(unittest.TestCase):
    def test_visit_switch_targets_public_tls_and_health_without_enabling_document_logs(self):
        args = dict(web_host='web-blue', public_api_host='api-blue', admin_api_host='api-blue')
        off = SLOTS['gateway_files'](HERE, **args)['default.conf']
        on = SLOTS['gateway_files'](HERE, **args, page_visits=True)['default.conf']
        self.assertEqual(off.count('set $hd_page_visits_enabled 0;'), 2)
        self.assertEqual(on, off.replace('set $hd_page_visits_enabled 0;', 'set $hd_page_visits_enabled 1;'))
        self.assertNotIn('set $hd_page_documents_enabled 1;', on)
        self.assertFalse(any('stdout' in line for line in on.splitlines() if 'hd_page_visit ' in line))


@contextmanager
def gateway(enabled, documents_enabled=False):
    with tempfile.TemporaryDirectory(prefix='hdv-') as work, socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as receiver:
        root = Path(work).resolve()
        receiver.bind(str(root/'ev.sock'))
        receiver.settimeout(.25)
        with socket.socket(socket.AF_INET) as address:
            address.bind(('127.0.0.1', 0))
            port = address.getsockname()[1]
        documents = (HERE/'nginx-domains/page-documents.conf').read_text().replace('):3010:hit$', '):hit$')
        visits = (HERE/'nginx-domains/page-visits.conf').read_text()
        # Use the actual production destinations and formats with only the
        # destination socket pathname replaced by the test's private pathname.
        live_logs = (line.strip().replace('/run/hd-visits/events.sock', str(root/'ev.sock'))
                     for line in (HERE/'nginx-domains.conf').read_text().splitlines()
                     if 'access_log syslog:server=unix:/run/hd-visits/events.sock' in line)
        heartbeat_log, visit_log = live_logs
        config = root/'nginx.conf'
        root_user = 'user root;\n' if os.getuid() == 0 else ''
        config.write_text(root_user+f'''pid {root}/pid;
events {{ worker_connections 64; }}
http {{
    client_body_temp_path {root}/body;
    proxy_temp_path {root}/proxy;
    error_log /dev/null crit;
    # Prove socket-peer selection even if an independent real-IP policy is added.
    real_ip_header X-Forwarded-For;
    set_real_ip_from 127.0.0.1;
    set_real_ip_from unix:;
    {documents}
    {visits}
    log_format diagnostics '{{"status":$status}}';
    upstream html-cache-blue {{ server unix:{root}/hot.sock; }}
    server {{
        listen unix:{root}/hot.sock;
        access_log off;
        default_type text/html;
        add_header X-HD-Cache-Document hit;
        return 200 'cached document';
    }}
    server {{
        listen 127.0.0.1:{port} default_server;
        listen unix:{root}/health.sock;
        server_name _;
        location = /health/proxy {{
            set $hd_page_visits_enabled {int(enabled)};
            {heartbeat_log}
            return 200 'ok';
        }}
        location / {{ return 404; }}
    }}
    server {{
        listen 127.0.0.1:{port};
        server_name cars.hongdingauto.com;
        set $hd_page_visits_enabled {int(enabled)};
        set $hd_page_documents_enabled {int(documents_enabled)};
        access_log {root}/documents.log hd_page_document if=$hd_page_document_selected;
        access_log {root}/diagnostics.log diagnostics;
        {visit_log}
        default_type 'text/html; charset=utf-8';
        location = /zh/cars/missing/ {{ return 404; }}
        location = /zh/cars/failed/ {{ return 503; }}
        location = /ru/ {{ proxy_pass http://html-cache-blue; proxy_hide_header X-HD-Cache-Document; }}
        location / {{ return 200 'document'; }}
    }}
    server {{
        listen 127.0.0.1:{port};
        server_name admin.hongdingauto.com;
        default_type text/html;
        return 200 'admin page';
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
                while not (root/'health.sock').is_socket():
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError('Visit gateway did not start')
                    time.sleep(.025)
                yield root, port, receiver
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)


def request(destination, path, *, host='cars.hongdingauto.com', headers=None, method='GET'):
    unix = isinstance(destination, Path)
    values = {'Host': host, 'User-Agent': 'FixtureBrowser', 'Connection': 'close',
              'Sec-Fetch-Dest': 'document', **(headers or {})}
    wire = (f'{method} {path} HTTP/1.1\r\n'
            + ''.join(f'{name}: {value}\r\n' for name, value in values.items()) + '\r\n')
    with socket.socket(socket.AF_UNIX if unix else socket.AF_INET) as client:
        client.settimeout(4)
        client.connect(str(destination) if unix else ('127.0.0.1', destination))
        client.sendall(wire.encode('ascii'))
        reply = http.client.HTTPResponse(client, method=method)
        reply.begin()
        reply.read()
        return reply.status


@unittest.skipUnless(NGINX, 'native nginx is required')
class VisitDatagrams(unittest.TestCase):
    def test_hot_cache_response_and_cold_origin_each_deliver_one_visit_candidate(self):
        with gateway(True, documents_enabled=True) as (root, port, receiver):
            for path in ('/ru/', '/en/'):
                self.assertEqual(request(port, path), 200)
                self.assertIsNotNone(VISIT.fullmatch(receiver.recv(128)))
            rows = [json.loads(line) for line in (root/'documents.log').read_text().splitlines()]
            self.assertEqual([(row['locale'], row['cache']) for row in rows], [('ru', 'hot'), ('en', 'cold')])
            with self.assertRaises(TimeoutError):
                receiver.recv(128)

    def test_wire_minimal_origin_and_selector_with_document_logging_off(self):
        with gateway(True) as (root, port, receiver):
            for path in ('/zh/cars/?private-query=yes', '/en/'):
                self.assertEqual(request(port, path, headers={'X-Forwarded-For':'203.0.113.67',
                      'Referer':'https://sentinel.example/private', 'Cookie':'secret=credential'}), 200)
                packet = receiver.recv(128)
                self.assertIsNotNone(VISIT.fullmatch(packet))
            for path, headers, method, host, status in (
                ('/zh/cars/', {'RSC':'1'}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/', {'Sec-Purpose':'prefetch'}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/', {'User-Agent':'FixtureWebCrawler'}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/', {}, 'HEAD', 'cars.hongdingauto.com', 200),
                ('/zh/cars/missing/', {}, 'GET', 'cars.hongdingauto.com', 404),
                ('/zh/cars/failed/', {}, 'GET', 'cars.hongdingauto.com', 503),
                ('/_next/static/f.js', {}, 'GET', 'cars.hongdingauto.com', 200),
                ('/internal/', {}, 'GET', 'cars.hongdingauto.com', 200),
                ('/zh/cars/', {}, 'GET', 'admin.hongdingauto.com', 200),
                ('/health/proxy', {}, 'POST', 'health.invalid', 200),
            ):
                self.assertEqual(request(port, path, headers=headers, method=method, host=host), status)
            self.assertEqual(request(root/'health.sock', '/health/proxy', host='health.invalid',
                                     headers={'X-Forwarded-For':'127.0.0.1'}), 200)
            with self.assertRaises(TimeoutError):
                receiver.recv(128)
            self.assertEqual(request(port, '/health/proxy', host='health.invalid',
                                     headers={'X-Forwarded-For':'203.0.113.67'}), 200)
            self.assertIsNotNone(COVERAGE.fullmatch(receiver.recv(128)))
            self.assertEqual((root/'documents.log').read_text(), '')
            diagnostic = (root/'diagnostics.log').read_text() + (root/'bootstrap.log').read_text()
            for marker in ('private-query', 'sentinel.example', 'credential', '203.0.113.67', '127.0.0.1', 'hd_visit:'):
                self.assertNotIn(marker, diagnostic)

    def test_default_off_and_unavailable_receiver_both_serve_success(self):
        with gateway(False) as (_, port, receiver):
            self.assertEqual(request(port, '/zh/cars/'), 200)
            self.assertEqual(request(port, '/health/proxy', host='health.invalid'), 200)
            with self.assertRaises(TimeoutError):
                receiver.recv(128)
        with gateway(True) as (root, port, receiver):
            receiver.close()
            (root/'ev.sock').unlink()
            self.assertEqual(request(port, '/zh/cars/?sink=unavailable'), 200)
            self.assertNotIn('sink=unavailable', (root/'bootstrap.log').read_text())

    def test_full_receiver_does_not_block_pages(self):
        with gateway(True) as (_, port, receiver):
            receiver.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
            # Deliberately never drain the tiny receive buffer during the burst.
            for _ in range(40):
                self.assertEqual(request(port, '/en/'), 200)
            observed = 0
            try:
                while receiver.recv(128):
                    observed += 1
            except TimeoutError:
                pass
            self.assertGreater(observed, 0)
            self.assertLess(observed, 40)


if __name__ == '__main__':
    unittest.main()
