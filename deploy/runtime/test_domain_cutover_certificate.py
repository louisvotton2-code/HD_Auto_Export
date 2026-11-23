import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, call, patch


HOOK = Path(__file__).with_name('domain-cutover-cert-deploy-hook.py')
SPEC = importlib.util.spec_from_file_location('domain_cutover_cert_hook', HOOK)
hook = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = hook
SPEC.loader.exec_module(hook)
APEX = hook.CERTIFICATES['apex']
ADMIN = hook.CERTIFICATES['admin']


class Boundaries(unittest.TestCase):
    def test_cli_silently_ignores_other_renewals(self):
        for lineage in ('/etc/letsencrypt/live/hd-auto', '/etc/letsencrypt/live/hd-auto-admin-0001'):
            with self.subTest(lineage=lineage):
                outcome = subprocess.run([sys.executable, str(HOOK)], check=True, capture_output=True,
                                         env={**os.environ, 'RENEWED_LINEAGE': lineage})
                self.assertEqual((outcome.stdout, outcome.stderr), (b'', b''))
        refused = subprocess.run([sys.executable, str(HOOK), '--install', 'other'], capture_output=True)
        self.assertEqual(refused.returncode, 2)

    def test_gateway_requires_the_reviewed_readonly_tls_bind(self):
        with tempfile.TemporaryDirectory() as directory:
            tls = Path(directory).resolve()
            mount = {'Destination': '/run/tls', 'Source': str(tls), 'Type': 'bind', 'RW': False}
            proxy = {'Id': 'immutable-gateway', 'State': {'Running': True, 'StartedAt': 'unchanged'}, 'Mounts': [mount]}
            with patch.object(hook, 'TLS_ROOT', tls), patch.object(hook, 'run', return_value=json.dumps([proxy]).encode()):
                self.assertEqual(hook.current_proxy(), ('immutable-gateway', 'unchanged'))
            mount['RW'] = True
            with patch.object(hook, 'TLS_ROOT', tls), patch.object(hook, 'run', return_value=json.dumps([proxy]).encode()):
                with self.assertRaisesRegex(ValueError, 'TLS mount does not match'):
                    hook.current_proxy()

    def test_nginx_uses_running_master_configuration(self):
        explicit = b'nginx: master process nginx -c /etc/nginx/nginx-media-main.conf -g daemon off;\0'
        default = b"nginx: master process nginx -g 'daemon off;'\0"
        configured = SimpleNamespace(stderr=b'configure arguments: --conf-path=/etc/nginx/nginx.conf')
        for title, expected in ((explicit, '/etc/nginx/nginx-media-main.conf'), (default, '/etc/nginx/nginx.conf')):
            with self.subTest(title=title), patch.object(hook, 'run', return_value=title), \
                    patch.object(hook, 'capture', return_value=configured):
                self.assertEqual(hook.nginx_command()[-2:], ('-c', expected))
        unsafe = b'nginx: master process nginx -c /etc/nginx/nginx.conf -g daemon off; pid /tmp/alternate.pid;\0'
        with patch.object(hook, 'run', return_value=unsafe), self.assertRaises(ValueError):
            hook.nginx_command()

    def test_live_leaf_verification_uses_default_trust_and_sni_on_loopback(self):
        certificate_der = b'synthetic-leaf'
        for profile in (APEX, ADMIN):
            with self.subTest(profile=profile):
                connection = MagicMock()
                context = MagicMock()
                context.wrap_socket.return_value.__enter__.return_value.getpeercert.return_value = certificate_der
                with patch.object(hook, 'run', return_value=certificate_der), \
                        patch.object(hook.ssl, 'create_default_context', return_value=context) as trust, \
                        patch.object(hook.socket, 'create_connection', return_value=connection) as connect:
                    hook.verify_live_certificate(profile, Path('fixture-chain.pem'))
                trust.assert_called_once_with()
                self.assertEqual(context.wrap_socket.call_args_list, [
                    call(connection.__enter__.return_value, server_hostname=host) for host in profile.hosts])
                self.assertEqual([attempt.args for attempt in connect.call_args_list],
                                 [(('127.0.0.1', 443),)] * len(profile.hosts))

    def test_live_leaf_verification_rejects_stale_leaf_or_untrusted_handshake(self):
        for handshake_error in (None, ssl.SSLCertVerificationError('untrusted certificate')):
            with self.subTest(handshake_error=handshake_error):
                context = MagicMock()
                context.wrap_socket.return_value.__enter__.return_value.getpeercert.return_value = b'stale-leaf'
                context.wrap_socket.side_effect = handshake_error
                with patch.object(hook, 'LIVE_TLS_VERIFY_SECONDS', .01), patch.object(hook, 'run', return_value=b'new-leaf'), \
                        patch.object(hook.ssl, 'create_default_context', return_value=context), \
                        patch.object(hook.socket, 'create_connection', return_value=MagicMock()), \
                        self.assertRaisesRegex(ValueError, 'Live HTTPS'):
                    hook.verify_live_certificate(APEX, Path('fixture-chain.pem'))


@unittest.skipUnless(shutil.which('openssl'), 'OpenSSL required for synthetic certificate verification')
class Certificates(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bundle = cls.enterClassContext(tempfile.TemporaryDirectory(prefix='hd-domain-cert-test-'))
        root = Path(bundle)
        cls.pairs = {}
        for generation, hosts in enumerate((APEX.hosts, APEX.hosts, ADMIN.hosts, APEX.hosts + ADMIN.hosts), start=1):
            cert, key = root/f'fullchain{generation}.pem', root/f'privkey{generation}.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
                            '-nodes', '-days', '2', '-subj', '/CN=fixture.invalid',
                            '-addext', 'subjectAltName=' + ','.join(f'DNS:{host}' for host in hosts),
                            '-out', str(cert), '-keyout', str(key)], check=True, capture_output=True)
            cls.pairs[generation] = cert, key

    def test_rejects_extra_san_wrong_profile_and_mismatched_key(self):
        hook.check_certificate(APEX, *self.pairs[1])
        hook.check_certificate(ADMIN, *self.pairs[3])
        for profile, pair in ((APEX, self.pairs[4]), (ADMIN, self.pairs[1]),
                              (APEX, (self.pairs[1][0], self.pairs[2][1]))):
            with self.subTest(profile=profile, pair=pair), self.assertRaises(ValueError):
                hook.check_certificate(profile, *pair)

    def test_lineage_files_must_use_the_matching_archive_and_private_key_mode(self):
        directory = self.enterContext(tempfile.TemporaryDirectory(prefix='hd-certbot-lineage-'))
        root = Path(directory).resolve()
        lineage, archive = root/'live', root/'archive'
        lineage.mkdir()
        archive.mkdir()
        fixture = SimpleNamespace(lineage=lineage, archive=archive)
        cert, key = archive/'fullchain1.pem', archive/'privkey1.pem'
        cert.write_bytes(self.pairs[1][0].read_bytes())
        key.write_bytes(self.pairs[1][1].read_bytes())
        key.chmod(0o600)
        (lineage/'fullchain.pem').symlink_to(cert)
        (lineage/'privkey.pem').symlink_to(key)
        lstat = Path.lstat
        def as_root(path):
            details = lstat(path)
            return SimpleNamespace(st_uid=0, st_mode=details.st_mode, st_size=details.st_size)
        with patch.object(Path, 'lstat', as_root):
            self.assertEqual(hook.source_file(fixture, 'fullchain'), ('1', cert.read_bytes()))
            self.assertEqual(hook.source_file(fixture, 'privkey', private=True), ('1', key.read_bytes()))
            key.chmod(0o640)
            with self.assertRaisesRegex(ValueError, 'permissions'):
                hook.source_file(fixture, 'privkey', private=True)
            with self.assertRaisesRegex(ValueError, 'Unexpected certificate lineage'):
                hook.source_file(SimpleNamespace(lineage=lineage, archive=root/'other'), 'fullchain')

    def test_install_and_renewal_keep_certificates_and_rollback_independent(self):
        directory = self.enterContext(tempfile.TemporaryDirectory(prefix='hd-domain-hook-install-'))
        root = Path(directory).resolve()
        tls, release_lock, reload_lock = root/'tls', root/'release.lock', root/'reload.lock'
        tls.mkdir(mode=0o700)
        for lock in (release_lock, reload_lock):
            lock.touch(mode=0o600)
        apex = tls/'apex'
        versions = apex/'versions'
        legacy = 'versions/' + 'a'*64
        previous = apex/legacy
        for path in (apex, versions, previous):
            path.mkdir(mode=0o750)
            path.chmod(0o750)
        selected = {APEX: 1, ADMIN: 3}
        for source, name in zip(self.pairs[1], ('server.crt', 'server.key')):
            (previous/name).write_bytes(source.read_bytes())
        current = apex/'current'
        current.symlink_to(legacy)

        def source_file(profile, name, **_):
            choice = selected[profile]
            return str(choice), self.pairs[choice][0 if name == 'fullchain' else 1].read_bytes()

        # Use real OpenSSL, files and advisory locks. Mock root ownership only for
        # the temporary fixture, so the test never needs host privileges.
        lstat, fstat, lock, openssl = Path.lstat, os.fstat, fcntl.flock, hook.run
        def root_owned(details):
            return SimpleNamespace(st_uid=0, st_gid=0, st_mode=details.st_mode)
        locks = []
        def record_lock(file, operation):
            locks.append((fstat(file.fileno()).st_ino, operation))
            return lock(file, operation)
        reload_calls = []
        failures = []
        def gateway(*arguments):
            if arguments[0] == 'openssl':
                return openssl(*arguments)
            reload_calls.append(arguments)
            if failures and arguments[-1] == failures[0]:
                failures.pop()
                raise subprocess.CalledProcessError(1, arguments)
            return b''
        served = []
        stale_versions = []
        def verify_live(profile, path):
            material = path.read_bytes()
            served.append((profile, material))
            if stale_versions and material == stale_versions[0]:
                stale_versions.pop()
                raise ValueError('Live HTTPS did not switch certificates')

        with patch.multiple(hook, TLS_ROOT=tls, RELEASE_LOCK=release_lock, RELOAD_LOCK=reload_lock,
                            source_file=source_file, run=gateway, current_proxy=lambda: ('gateway', 'same'),
                            nginx_command=lambda: ('nginx', '-c', '/fixture/main.conf'), verify_live_certificate=verify_live), \
                patch.object(os, 'geteuid', return_value=0), patch.object(os, 'fstat', lambda fd: root_owned(fstat(fd))), \
                patch.object(Path, 'lstat', lambda path: root_owned(lstat(path))), patch.object(fcntl, 'flock', record_lock):
            hook.install(APEX)
            self.assertEqual(os.readlink(current), legacy)
            selected[APEX] = 2
            failures.append('-t')
            with self.assertRaises(subprocess.CalledProcessError):
                hook.install(APEX)
            self.assertEqual(os.readlink(current), legacy)
            self.assertEqual(reload_calls[-2:], [('nginx', '-c', '/fixture/main.conf', '-t'),
                                                ('nginx', '-c', '/fixture/main.conf', '-s', 'reload')])
            stale_versions.append(self.pairs[2][0].read_bytes())
            with self.assertRaisesRegex(ValueError, 'Live HTTPS'):
                hook.install(APEX)
            self.assertEqual(os.readlink(current), legacy)
            self.assertEqual(served[-2:], [(APEX, self.pairs[2][0].read_bytes()),
                                          (APEX, self.pairs[1][0].read_bytes())])
            hook.install(APEX)
            updated = os.readlink(current)
            self.assertNotEqual(updated, legacy)
            self.assertEqual((current/'server.crt').read_bytes(), self.pairs[2][0].read_bytes())
            hook.install(ADMIN)
            self.assertEqual(os.readlink(current), updated)
            self.assertEqual((tls/'admin/current/server.crt').read_bytes(), self.pairs[3][0].read_bytes())

        expected = [(release_lock.stat().st_ino, fcntl.LOCK_SH | fcntl.LOCK_NB),
                    (reload_lock.stat().st_ino, fcntl.LOCK_EX | fcntl.LOCK_NB)]
        self.assertEqual(locks, expected * 5)


if __name__ == '__main__':
    unittest.main()
