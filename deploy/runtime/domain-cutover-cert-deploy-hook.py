#!/usr/bin/env python3
"""Install independent Certbot lineages behind already configured HTTPS ingress."""

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shlex
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time


TLS_ROOT = Path('/srv/hd-auto/data/current/tls')
GATEWAY_ROOT = Path('/srv/hd-auto/staging/gateway')
RELEASE_LOCK = GATEWAY_ROOT / 'release.lock'
RELOAD_LOCK = GATEWAY_ROOT / 'reload.lock'
DOCKER = ('docker', '--host=unix:///var/run/docker.sock')
PROXY = 'hd-auto-proxy-1'
LIVE_TLS_VERIFY_SECONDS = 10


@dataclass(frozen=True)
class Certificate:
    lineage_name: str
    destination: str
    hosts: tuple[str, ...]

    @property
    def lineage(self):
        return Path('/etc/letsencrypt/live') / self.lineage_name

    @property
    def archive(self):
        return Path('/etc/letsencrypt/archive') / self.lineage_name


CERTIFICATES = {
    'apex': Certificate('hd-auto-apex', 'apex', ('hongdingauto.com', 'www.hongdingauto.com')),
    'admin': Certificate('hd-auto-admin', 'admin', ('admin.hongdingauto.com',)),
}


def capture(*arguments):
    env = {k: v for k, v in os.environ.items() if k not in ('DOCKER_HOST', 'DOCKER_CONTEXT')}
    return subprocess.run(arguments, check=True, capture_output=True, timeout=15, env=env)


def run(*arguments):
    return capture(*arguments).stdout


def private_directory(path):
    path.mkdir(mode=0o700, exist_ok=True)
    details = path.lstat()
    if (not stat.S_ISDIR(details.st_mode) or (details.st_uid, details.st_gid) != (0, 0)
            or stat.S_IMODE(details.st_mode) not in (0o700, 0o750)):
        raise ValueError('Invalid private certificate directory')


def source_file(certificate, name, private=False):
    path = (certificate.lineage / f'{name}.pem').resolve(strict=True)
    generation = re.fullmatch(rf'{name}([1-9]\d*)\.pem', path.name)
    details = path.lstat()
    if path.parent != certificate.archive or not generation or not stat.S_ISREG(details.st_mode) or details.st_uid != 0:
        raise ValueError('Unexpected certificate lineage file')
    if not 0 < details.st_size < 64 * 1024 or details.st_mode & (0o077 if private else 0o022):
        raise ValueError('Invalid certificate lineage file permissions or size')
    return generation[1], path.read_bytes()


def check_certificate(certificate, cert, key):
    lines = run('openssl', 'x509', '-in', str(cert), '-noout', '-ext', 'subjectAltName').decode().splitlines()
    names = [item.strip() for item in ' '.join(lines[1:]).split(',')]
    required_names = {f'DNS:{host}' for host in certificate.hosts}
    if (not lines or not lines[0].startswith('X509v3 Subject Alternative Name:')
            or len(names) != len(required_names) or set(names) != required_names):
        raise ValueError('Unexpected subject alternative names')
    run('openssl', 'x509', '-in', str(cert), '-noout', '-checkend', '86400')
    if run('openssl', 'x509', '-in', str(cert), '-noout', '-pubkey') != run(
        'openssl', 'pkey', '-in', str(key), '-passin', 'pass:', '-pubout',
    ):
        raise ValueError('Certificate and private key do not match')


def verify_live_certificate(certificate, cert):
    expected = run('openssl', 'x509', '-in', str(cert), '-outform', 'DER')
    context = ssl.create_default_context()
    deadline = time.monotonic() + LIVE_TLS_VERIFY_SECONDS
    pending = set(certificate.hosts)
    while pending and time.monotonic() < deadline:
        for host in certificate.hosts:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            if host not in pending:
                continue
            try:
                with socket.create_connection(('127.0.0.1', 443), timeout=min(2, remaining / 2)) as connection:
                    with context.wrap_socket(connection, server_hostname=host) as https:
                        if https.getpeercert(binary_form=True) == expected:
                            pending.remove(host)
            except OSError:
                continue
        if pending:
            time.sleep(max(0, min(.25, deadline - time.monotonic())))
    if pending:
        raise ValueError('Live HTTPS did not present the selected certificate for every hostname')


def current_proxy():
    proxy, = json.loads(run(*DOCKER, 'container', 'inspect', PROXY))
    mounts = [mount for mount in proxy['Mounts'] if mount['Destination'] == '/run/tls']
    if not proxy['State']['Running'] or len(mounts) != 1:
        raise ValueError('Running gateway TLS mount required')
    mount = mounts[0]
    if mount['Type'] != 'bind' or mount['RW'] or Path(mount['Source']).resolve(strict=True) != TLS_ROOT.resolve(strict=True):
        raise ValueError('Gateway TLS mount does not match')
    return proxy['Id'], proxy['State']['StartedAt']


def nginx_command():
    command = (*DOCKER, 'exec', PROXY, 'nginx')
    title = run(*DOCKER, 'exec', PROXY, 'cat', '/proc/1/cmdline').replace(b'\0', b' ').decode().strip()
    master = 'nginx: master process nginx'
    if title != master and not title.startswith(master + ' '):
        raise ValueError('Unexpected gateway process')
    args = shlex.split(title[len(master):])
    config = None
    global_seen = False
    while args:
        arg = args.pop(0)
        if arg.startswith('-c') and config is None:
            config = arg[2:] or (args.pop(0) if args else '')
        elif arg == '-g' and not global_seen:
            if args[:1] == ['daemon off;']:
                del args[:1]
            elif args[:2] == ['daemon', 'off;']:
                del args[:2]
            else:
                raise ValueError('Unexpected gateway master global option')
            global_seen = True
        else:
            raise ValueError('Unexpected gateway master option')
    if config is None:
        build = capture(*command, '-V').stderr.decode()
        configs = [arg.removeprefix('--conf-path=') for arg in shlex.split(build) if arg.startswith('--conf-path=')]
        if len(configs) != 1:
            raise ValueError('Cannot determine gateway main configuration')
        config = configs[0]
    path = PurePosixPath(config)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Invalid gateway main configuration')
    return (*command, '-c', config)


def replace_current(current, version):
    pending = current.with_name(f'.current-{secrets.token_hex(12)}')
    pending.symlink_to(version)
    try:
        os.replace(pending, current)
    finally:
        pending.unlink(missing_ok=True)


def old_version(current):
    if not current.is_symlink():
        if current.exists():
            raise ValueError('Certificate current is not a version link')
        return None
    version = os.readlink(current)
    if not re.fullmatch(r'versions/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}', version):
        raise ValueError('Certificate current has an unsafe version target')
    target = current.resolve(strict=True)
    if target != (current.parent.resolve(strict=True) / version):
        raise ValueError('Current certificate version contains an unexpected link')
    private_directory(target)
    return version


@contextmanager
def acquire_lock(path, lock_type):
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+b') as lock:
        details = os.fstat(lock.fileno())
        if not stat.S_ISREG(details.st_mode) or details.st_uid != 0 or details.st_mode & 0o022:
            raise ValueError('Unexpected gateway lock')
        deadline = time.monotonic() + 30
        while True:
            try:
                fcntl.flock(lock, lock_type | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.25)
        yield


def install(certificate):
    if os.geteuid() != 0:
        raise ValueError('Certificate installation must be run by root')
    tls = TLS_ROOT.lstat()
    if not stat.S_ISDIR(tls.st_mode) or tls.st_uid != 0 or tls.st_mode & 0o022:
        raise ValueError('Unexpected gateway TLS directory')
    with acquire_lock(RELEASE_LOCK, fcntl.LOCK_SH), acquire_lock(RELOAD_LOCK, fcntl.LOCK_EX):
        gateway, nginx = current_proxy(), nginx_command()
        cert_generation, cert = source_file(certificate, 'fullchain')
        key_generation, key = source_file(certificate, 'privkey', private=True)
        if cert_generation != key_generation:
            raise ValueError('Certificate lineage files belong to different generations')
        destination = TLS_ROOT / certificate.destination
        versions = destination / 'versions'
        private_directory(destination)
        private_directory(versions)
        current = destination / 'current'
        previous = old_version(current)
        version = previous
        if previous is None or (current / 'server.crt').read_bytes() != cert or (current / 'server.key').read_bytes() != key:
            with tempfile.TemporaryDirectory(prefix='.install-', dir=versions) as folder:
                stage = Path(folder)
                for name, content in (('server.crt', cert), ('server.key', key)):
                    with (stage / name).open('xb') as dest:
                        dest.write(content)
                        dest.flush()
                        os.fsync(dest.fileno())
                check_certificate(certificate, stage / 'server.crt', stage / 'server.key')
                version = 'versions/' + secrets.token_hex(16)
                stage.rename(destination / version)
            replace_current(current, version)
        else:
            check_certificate(certificate, current / 'server.crt', current / 'server.key')
        try:
            run(*nginx, '-t')
            run(*nginx, '-s', 'reload')
            verify_live_certificate(certificate, current / 'server.crt')
            if current_proxy() != gateway:
                raise ValueError('Gateway container changed during certificate reload')
        except (OSError, ValueError, subprocess.SubprocessError):
            if previous is None:
                current.unlink()
            elif version != previous:
                replace_current(current, previous)
            try:
                run(*nginx, '-t')
                run(*nginx, '-s', 'reload')
                if previous is not None:
                    verify_live_certificate(certificate, current / 'server.crt')
            except (OSError, ValueError, subprocess.SubprocessError):
                print('Certificate rollback needs gateway verification.', file=sys.stderr)
            raise
    print(f'{certificate.lineage_name} TLS installed and verified on the existing HTTPS gateway.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', nargs='?', const='apex', choices=CERTIFICATES,
                        help='Install from a fixed live lineage (default: apex)')
    args = parser.parse_args()
    if args.install:
        selected = CERTIFICATES[args.install]
    else:
        selected = next((c for c in CERTIFICATES.values()
                         if os.environ.get('RENEWED_LINEAGE') == str(c.lineage)), None)
    if selected is not None:
        os.umask(0o077)
        try:
            install(selected)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            print(f'{selected.lineage_name} TLS installation failed ({type(error).__name__}).', file=sys.stderr)
            sys.exit(1)
