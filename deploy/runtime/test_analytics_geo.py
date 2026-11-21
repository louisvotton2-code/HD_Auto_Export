"""Test the opt-in country table and gateway boundary with a synthetic fixture."""

from contextlib import contextmanager
import gzip
import hashlib
import http.client
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
NGINX = shutil.which('nginx')
GEO = runpy.run_path(str(HERE/'production/build-analytics-geo.py'))
KEY_FRAGMENT = runpy.run_path(str(HERE/'production/prepare-analytics-gateway-key.py'))
HOST = 'cars.hongdingauto.com'
PATH = '/api/v1/analytics/events'
CONTACT = '/api/v1/analytics/contact-count'
FIXTURE_KEY = 'a'*64
FIXTURE = (
    b'8.8.8.0,8.8.8.255,US\n'
    b'9.9.9.0,9.9.9.255,ZZ\n'
    b'10.0.0.1,10.0.0.1,DE\n'
    b'2001:4860::,2001:4860::ffff,RU\n'
)


def source(root, payload):
    path = root/'dataset.csv.gz'
    archived = gzip.compress(payload, mtime=0)
    path.write_bytes(archived)
    return path, hashlib.sha256(archived).hexdigest()


class CountryMapTests(unittest.TestCase):
    def test_prepares_private_validated_key_fragment_without_overwriting(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work).resolve()
            source_key = root/'api.key'
            source_key.write_text(FIXTURE_KEY+'\n')
            source_key.chmod(0o600)
            output = root/'gateway-key.conf'
            KEY_FRAGMENT['prepare'](source_key, output)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(output.read_text(), f'{HOST} {FIXTURE_KEY};\n')
            with self.assertRaises(FileExistsError):
                KEY_FRAGMENT['prepare'](source_key, output)
            output.unlink()
            source_key.write_text(FIXTURE_KEY+';default forged;')
            with self.assertRaises(ValueError):
                KEY_FRAGMENT['prepare'](source_key, output)
            self.assertFalse(output.exists())

    def test_country_table_reproduces_ipv4_and_ipv6_with_hash(self):
        with tempfile.TemporaryDirectory() as work:
            path = Path(work)
            archive, expected = source(path, FIXTURE)
            target = path/'country.conf'
            result = GEO['build'](archive, expected, target)
            self.assertEqual(result, {
                'sourceSha256': expected,
                'tableSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                'ipv4Prefixes': 2,
                'ipv6Prefixes': 1,
            })
            entries = target.read_text().splitlines()
            self.assertEqual(entries[1:], ['8.8.8.0/24 US;', '10.0.0.1/32 DE;', '2001:4860::/112 RU;'])
            with self.assertRaises(FileExistsError):
                GEO['build'](archive, expected, target)
            self.assertEqual(target.read_text().splitlines(), entries)

    def test_invalid_ranges_and_digest_leave_no_table(self):
        for payload in (
            b'8.8.8.0,8.8.8.255,US\n8.8.8.100,8.8.8.120,CN\n',
            b'2001:4860::2,2001:4860::1,RU\n',
            b'8.8.8.0,2001:4860::,EU\n',
            b'8.8.8.0,8.8.8.255,US;#\n',
            b'8.8.8.0,8.8.8.255,US\n2001:4860::%en0,2001:4860::ffff,US\n',
            b'8.8.8.0,8.8.8.255,US\n',
        ):
            with self.subTest(payload=payload), tempfile.TemporaryDirectory() as work:
                root = Path(work)
                archive, expected = source(root, payload)
                target = root/'country.conf'
                with self.assertRaises(ValueError):
                    GEO['build'](archive, '0'*64, target)
                with self.assertRaises(ValueError):
                    GEO['build'](archive, expected, target)
                self.assertEqual(list(root.iterdir()), [archive])


def nginx_command(root):
    return [NGINX, '-p', str(root)+'/', '-c', str(root/'nginx.conf'), '-e', str(root/'bootstrap.log')]


@contextmanager
def gateway(table, *, authenticated=None):
    # This test alone substitutes a synthetic source-address variable. Production
    # uses the socket peer in both maps and never consults an incoming IP header.
    with tempfile.TemporaryDirectory(prefix='hd-geo-') as work:
        root = Path(work).resolve()
        data = root/'dataset'
        data.mkdir(mode=0o700)
        use_key = table if authenticated is None else authenticated
        if use_key:
            key = root/'api.key'
            key.write_text(FIXTURE_KEY)
            key.chmod(0o600)
            KEY_FRAGMENT['prepare'](key, data/'gateway-key.conf')
        if table:
            archive, expected = source(root, FIXTURE)
            GEO['build'](archive, expected, data/'country.conf')
            (data/'ignored.conf').write_text('this cannot become an include;\n')
            lookup = data/'country.conf'
        else:
            lookup = HERE/'production/analytics-geo-disabled.conf'
        edge = (HERE/'nginx-edge.conf').read_text()
        for name in ('hd_analytics_country', 'hd_analytics_nonpublic'):
            production = f'geo $remote_addr ${name} {{'
            assert edge.count(production) == 1
            edge = edge.replace(production, f'geo $http_x_fixture_address ${name} {{')
        edge = edge.replace('/etc/nginx/hd-analytics-geo/country.conf', str(lookup))
        edge = edge.replace('/etc/nginx/hd-analytics-geo/gateway-key.[c]onf', str(data/'gateway-key.[c]onf'))
        if os.uname().sysname == 'Darwin':
            edge = edge.replace('zone=hd_edge_total:64k', 'zone=hd_edge_total:256k')
        api = (HERE/'nginx-domains/api-proxy.conf').read_text()
        front = (HERE/'nginx-domains/web-proxy.conf').read_text()
        config = root/'nginx.conf'
        root_user = 'user root;\n' if os.getuid() == 0 else ''
        config.write_text(root_user+f'''pid {root}/nginx.pid;
events {{ worker_connections 64; }}
http {{
    client_body_temp_path {root}/body;
    proxy_temp_path {root}/proxy;
    {edge}
    map $http_x_hd_analytics_gateway_key $fixture_authenticated {{
        default 0;
        {FIXTURE_KEY} 1;
    }}
    upstream origin {{ server unix:{root}/origin.sock; }}
    server {{
        listen unix:{root}/proxy.sock;
        server_name cars.hongdingauto.com admin.hongdingauto.com;
        access_log {root}/access.log hd_edge;
        location /api/ {{
            set $api http://origin;
            {api}
        }}
        location / {{
            set $web http://origin;
            {front}
        }}
    }}
    server {{
        listen unix:{root}/origin.sock;
        server_name _;
        access_log off;
        add_header X-HD-Analytics-Country ZZ always;
        add_header X-HD-Analytics-Gateway-Key fixture-origin-header always;
        return 200 "country=$http_x_hd_analytics_country;trusted=$fixture_authenticated";
    }}
}}
''')
        command = nginx_command(root)
        checked = subprocess.run([*command, '-t'], capture_output=True, text=True, timeout=5)
        if checked.returncode:
            raise RuntimeError(checked.stderr)
        with subprocess.Popen([*command, '-g', 'daemon off;'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
            try:
                start = time.monotonic()
                while not (root/'proxy.sock').is_socket():
                    if process.poll() is not None or time.monotonic()-start >= 3:
                        raise RuntimeError('Fixture gateway did not start')
                    time.sleep(.025)
                yield root
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)


def request(root, address, method='POST', path=PATH, host=HOST, origin=f'https://{HOST}'):
    with socket.socket(socket.AF_UNIX) as conn:
        conn.settimeout(5)
        conn.connect(str(root/'proxy.sock'))
        conn.sendall(f'{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n'
                     f'X-Fixture-Address: {address}\r\nX-Forwarded-For: 8.8.8.5\r\n'
                     f'Origin: {origin}\r\n'
                     f'X-HD-Analytics-Gateway-Key: {"b"*64}\r\n'
                     'X-HD-Analytics-Country: CN\r\nContent-Length: 0\r\n\r\n'.encode('ascii'))
        response = http.client.HTTPResponse(conn)
        response.begin()
        body = response.read()
        assert response.getheader('X-HD-Analytics-Gateway-Key') is None
        return response.status, response.getheader('X-HD-Analytics-Country'), body


def result(country=b'', authenticated=False):
    return (200, None, b'country='+country+b';trusted='+str(int(authenticated)).encode())


@unittest.skipUnless(NGINX, 'native nginx is required')
class GeoGatewayTests(unittest.TestCase):
    def test_scope_and_no_forwarded_spoofing(self):
        with gateway(True) as root:
            for address, method, path, host, country, trusted in (
                ('8.8.8.7', 'POST', CONTACT, HOST, b'US', True),
                ('2001:4860::1234', 'POST', CONTACT, HOST, b'RU', True),
                ('9.9.9.9', 'POST', CONTACT, HOST, b'', True),
                ('10.0.0.1', 'POST', CONTACT, HOST, b'', True),
                ('::ffff:10.0.0.1', 'POST', CONTACT, HOST, b'', True),
                ('bad', 'POST', CONTACT, HOST, b'', True),
                ('8.8.8.7', 'POST', PATH, HOST, b'', False),
                ('2001:4860::1234', 'POST', PATH, HOST, b'', False),
                ('8.8.8.7', 'POST', CONTACT+'/', HOST, b'', False),
                ('8.8.8.7', 'POST', CONTACT.upper(), HOST, b'', False),
                ('8.8.8.7', 'POST', CONTACT+'?test=1', HOST, b'', False),
                ('8.8.8.7', 'POST', CONTACT, 'admin.hongdingauto.com', b'', False),
                ('8.8.8.7', 'GET', CONTACT, HOST, b'', False),
                ('8.8.8.7', 'POST', '/zh/', HOST, b'', False),
            ):
                # Stay below the existing global SSR limiter on the Unix peer.
                with self.subTest(address=address, method=method, path=path, host=host):
                    self.assertEqual(request(root, address, method, path, host), result(country, trusted))
            self.assertEqual(request(root, '8.8.8.7', path=CONTACT, origin='https://fixture.invalid'), result())
            self.assertEqual(request(root, '8.8.8.7', path=CONTACT+':https', origin=f'//{HOST}'), result())
            log = (root/'access.log').read_text()
            for address in ('8.8.8.7', '8.8.8.5', '2001:4860::1234', '10.0.0.1'):
                self.assertNotIn(address, log)
            self.assertIn('"family":"analytics"', log)

    def test_missing_mount_disables_lookup_without_skipping_ingest(self):
        with gateway(False) as root:
            self.assertEqual(request(root, '8.8.8.7'), result())
        with gateway(True, authenticated=False) as root:
            self.assertEqual(request(root, '8.8.8.7', path=CONTACT), result())

    def test_empty_table_disables_live_lookup_without_restarting_gateway(self):
        with gateway(True) as root:
            pid = (root/'nginx.pid').read_text()
            self.assertEqual(request(root, '8.8.8.7', path=CONTACT), result(b'US', True))
            self.assertEqual(request(root, '8.8.8.7'), result())
            empty = root/'dataset/country.next'
            shutil.copyfile(HERE/'production/analytics-geo-disabled.conf', empty)
            empty.replace(root/'dataset/country.conf')
            command = nginx_command(root)
            subprocess.run([*command, '-t'], check=True, capture_output=True, timeout=5)
            subprocess.run([*command, '-s', 'reload'], check=True, capture_output=True, timeout=5)
            deadline = time.monotonic()+3
            while request(root, '8.8.8.7', path=CONTACT) == result(b'US', True) and time.monotonic() < deadline:
                time.sleep(.025)
            self.assertEqual(request(root, '8.8.8.7', path=CONTACT), result(authenticated=True))

            (root/'dataset/gateway-key.conf').unlink()
            subprocess.run([*command, '-t'], check=True, capture_output=True, timeout=5)
            subprocess.run([*command, '-s', 'reload'], check=True, capture_output=True, timeout=5)
            deadline = time.monotonic()+3
            while request(root, '8.8.8.7', path=CONTACT) == result(authenticated=True) and time.monotonic() < deadline:
                time.sleep(.025)
            self.assertEqual(request(root, '8.8.8.7', path=CONTACT), result())
            self.assertEqual(request(root, '8.8.8.7'), result())
            self.assertEqual((root/'nginx.pid').read_text(), pid)


if __name__ == '__main__':
    unittest.main()
