"""Reserve the v2 Nginx include paths without changing the running configuration."""

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import runpy
import shutil
import stat
import subprocess
import tempfile


HERE = Path(__file__).resolve().parent
GATEWAY = runpy.run_path(str(HERE / 'gateway-reload.py'))
ROOT, PROXY = GATEWAY['ROOT'], GATEWAY['PROXY']
SECTIONS = ('conf.d', 'hd-domains')
ADDITIONS = frozenset(PurePosixPath('hd-domains', name) for name in (
    'analytics-contact-count.conf', 'page-documents.conf', 'page-visits.conf', 'sitemap.conf',
))
PLACEHOLDER = b'# Reserved for the reviewed v2 gateway bundle.\n'
GEO = PurePosixPath('/etc/nginx/hd-analytics-geo/country.conf')
EMPTY_GEO = (HERE / 'analytics-geo-disabled.conf').read_bytes()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_node(path, predicate):
    info = path.lstat()
    require(predicate(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022,
            'Expected private canonical gateway files owned by the operator')


def tree(root):
    require(root.resolve() == root, 'Use canonical gateway directories')
    files = {}
    for section in SECTIONS:
        directory = root / section
        safe_node(directory, stat.S_ISDIR)
        for entry in directory.rglob('*'):
            info = entry.lstat()
            require(not entry.name.endswith('.pending'), 'Unfinished gateway configuration replacement')
            if stat.S_ISDIR(info.st_mode):
                safe_node(entry, stat.S_ISDIR)
            else:
                safe_node(entry, stat.S_ISREG)
                relative = PurePosixPath(entry.relative_to(root))
                files[relative] = entry.read_bytes()
    return files


def original_files(files):
    for path in files.keys() & ADDITIONS:
        require(files[path] == PLACEHOLDER, 'An include path already holds a non-placeholder configuration')
    return {path: value for path, value in files.items() if path not in ADDITIONS}


def topology(inspect, root):
    mounts = inspect['Mounts']
    names = tuple(PurePosixPath('/etc/nginx', section) for section in SECTIONS)
    mounted = set()
    geo_mounted = False
    for mount in mounts:
        target = PurePosixPath(mount['Destination'])
        for directory in names:
            if target.is_relative_to(directory) or directory.is_relative_to(target):
                require(target == directory and mount['Type'] == 'bind'
                        and mount['Source'] == str(root / directory.name), 'Unexpected gateway configuration mount')
                mounted.add(directory)
        if target.is_relative_to(GEO.parent) or GEO.is_relative_to(target):
            geo_mounted = True
    require(len(mounted) in (0, len(names)), 'Mixed gateway configuration mounts are unsupported')
    return bool(mounted), geo_mounted


def create_file(path, content):
    # Link from a prepared same-filesystem file. Even an outside writer cannot be overwritten.
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.gateway-v2-', delete=False) as temporary:
        stage = Path(temporary.name)
        try:
            temporary.write(content)
            temporary.flush()
            os.fchmod(temporary.fileno(), 0o644)
            os.fsync(temporary.fileno())
            os.link(stage, path, follow_symlinks=False)
        finally:
            stage.unlink()
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class DockerGateway:
    def __init__(self, name):
        self.name = name

    def run(self, *arguments, data=None):
        return subprocess.run(['docker', *arguments], input=data, check=True, capture_output=True, timeout=30).stdout

    def inspect(self):
        return json.loads(self.run('inspect', self.name))[0]

    def snapshot(self, root):
        for section in SECTIONS:
            self.run('cp', f'{self.name}:/etc/nginx/{section}', str(root / section))

    def nginx_command(self):
        return GATEWAY['nginx_command'](self.name)

    def validate(self, command):
        subprocess.run([*command, '-t'], check=True, capture_output=True, timeout=30)

    def geo(self):
        data = self.run('exec', '--user', '0', self.name, 'sh', '-ceu', '''
            p=$1
            test ! -L "${p%/*}"
            test ! -L "$p"
            if [ ! -e "$p" ]; then printf 'missing'; exit 0; fi
            test -f "$p"
            test "$(wc -c < "$p")" -le 1024
            printf 'present\n'; cat "$p"
        ''', 'sh', str(GEO))
        if data == b'missing':
            return None
        require(data.startswith(b'present\n'), 'Unexpected Geo include response')
        return data.removeprefix(b'present\n')

    def add(self, target, content):
        require(target == GEO or target.relative_to('/etc/nginx') in ADDITIONS,
                'Only explicitly reserved gateway paths can be added')
        self.run('exec', '-i', '--user', '0', self.name, 'sh', '-ceu', '''
            p=$1
            parent=${p%/*}
            test ! -L "$parent"
            if [ ! -e "$parent" ]; then mkdir -m 0755 "$parent"; fi
            test -d "$parent"
            test ! -e "$p"
            test ! -L "$p"
            tmp=$(mktemp "$parent/.gateway-v2-XXXXXX")
            trap 'rm -f "$tmp"' EXIT
            cat > "$tmp"
            chmod 0644 "$tmp"
            ln -T "$tmp" "$p"
        ''', 'sh', str(target), data=content)


@contextmanager
def lock(root):
    path = root / 'reload.lock'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(fd, 'ab') as handle:
        safe_node(path, stat.S_ISREG)
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def running_identity(inspect, expected):
    state = inspect['State']
    require(state['Running'] is True and state['StartedAt'] == expected, 'Gateway container stopped or changed identity')
    return inspect['Id'], state['StartedAt']


def prepare(root, candidate, gateway, expected_started_at):
    require(candidate.is_relative_to(root / 'bundles'), 'Use a reviewed gateway bundle')
    for directory in (root, root / 'bundles', root / 'rollback', candidate):
        require(directory.resolve() == directory, 'Use canonical gateway directories')
        safe_node(directory, stat.S_ISDIR)
    with lock(root):
        target = tree(candidate)
        inspected = gateway.inspect()
        identity = running_identity(inspected, expected_started_at)
        mounted, geo_mounted = topology(inspected, root)
        nginx = gateway.nginx_command()
        gateway.validate(nginx)

        audit = Path(tempfile.mkdtemp(prefix='v2-fileset-', dir=root / 'rollback'))
        live_before = audit / 'original-live'
        live_before.mkdir(mode=0o700)
        gateway.snapshot(live_before)
        live = tree(live_before)
        persistent = tree(root)
        baseline = original_files(live)
        require(persistent and baseline and original_files(persistent) == baseline,
                'Live and persisted pre-v2 configurations must match')
        require(target.keys() == baseline.keys() | ADDITIONS, 'Candidate does not have the exact v2 file-set additions')
        geo = gateway.geo()
        require(geo is None or geo == EMPTY_GEO, 'Existing Geo include differs from the reviewed disabled file')
        require(geo is not None or not geo_mounted, 'Prepare the disabled include on the existing Geo mount first')
        require(not inspected.get('HostConfig', {}).get('ReadonlyRootfs', False)
                or (mounted and geo is not None), 'Gateway root is read-only and a reserved include is missing')

        expected = {**baseline, **dict.fromkeys(ADDITIONS, PLACEHOLDER)}
        rollback = Path(tempfile.mkdtemp(prefix='v2-compatible-rollback-', dir=root / 'bundles'))
        for relative, value in sorted(expected.items()):
            path = rollback / relative
            path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            create_file(path, value)
        for section in SECTIONS:
            shutil.copytree(root / section, audit / 'original-persistent' / section)

        for relative in sorted(ADDITIONS):
            if not mounted and relative not in live:
                gateway.add(PurePosixPath('/etc/nginx') / relative, PLACEHOLDER)
            if relative not in persistent:
                create_file(root / relative, PLACEHOLDER)
        if geo is None:
            gateway.add(GEO, EMPTY_GEO)

        verify = audit / 'prepared-live'
        verify.mkdir(mode=0o700)
        gateway.snapshot(verify)
        require(tree(verify) == expected and tree(root) == expected and gateway.geo() == EMPTY_GEO,
                'Gateway include preparation did not match the reviewed file set')
        gateway.validate(nginx)
        require(running_identity(gateway.inspect(), expected_started_at) == identity and gateway.nginx_command() == nginx,
                'Gateway container or master configuration changed during preparation')
        result = {'original': str(audit), 'rollback': str(rollback), 'nginxConfig': nginx[-1],
                  'proxyStartedAt': identity[1], 'proxyId': identity[0], 'reloaded': False,
                  'baselineSha256': {str(path): hashlib.sha256(body).hexdigest() for path, body in sorted(baseline.items())}}
        (audit / 'prepared.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--expected-started-at', required=True, help='StartedAt from the reviewed running gateway')
    args = parser.parse_args()
    try:
        require(os.getuid() == 0, 'Run as the gateway operator')
        print(json.dumps(prepare(ROOT, args.candidate, DockerGateway(PROXY), args.expected_started_at), sort_keys=True))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        message = str(error) if isinstance(error, ValueError) else 'Inspect the old configuration and the private preparation snapshot'
        parser.exit(1, f'Gateway include preparation failed. {message}\n')


if __name__ == '__main__':
    main()
