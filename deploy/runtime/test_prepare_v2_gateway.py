"""Validate add-only v2 gateway preparation with isolated container trees."""

import os
from pathlib import Path, PurePosixPath
import runpy
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
PREP = runpy.run_path(str(HERE / 'production/prepare-v2-gateway.py'))
SECTIONS = PREP['SECTIONS']
ADDITIONS = PREP['ADDITIONS']
PLACEHOLDER = PREP['PLACEHOLDER']
GEO = PREP['GEO']
EMPTY_GEO = PREP['EMPTY_GEO']
START = '2026-11-21T05:47:34.683943255Z'


class Gateway:
    def __init__(self, root, live, mounts=()):
        self.root = root
        self.live = live
        self.mounts = list(mounts)
        self.started = START
        self.validations = []
        self.additions = []
        self.before_add = None
        self.before_inspect = None
        self.main = root / 'nginx.conf'
        self.main.write_text(f'pid {root}/nginx.pid; events {{}} http {{ include {live}/conf.d/*.conf; }}\n')

    def inspect(self):
        if self.before_inspect:
            self.before_inspect()
        return {'Id': 'test-proxy', 'State': {'Running': True, 'StartedAt': self.started}, 'Mounts': self.mounts}

    def nginx_command(self):
        return ['nginx', '-c', str(self.main)]

    def validate(self, command):
        self.validations.append([*command, '-t'])
        if shutil.which('nginx'):
            completed = subprocess.run([*command, '-e', str(self.root / 'error.log'), '-p', str(self.root) + '/', '-t'],
                                       check=False, capture_output=True, text=True)
            if completed.returncode:
                raise RuntimeError(completed.stderr)

    def snapshot(self, root):
        for section in SECTIONS:
            shutil.copytree(self.live / section, root / section)

    def geo(self):
        path = self.live / GEO.relative_to('/etc/nginx')
        return path.read_bytes() if path.exists() else None

    def add(self, target, content):
        self.additions.append(target)
        if self.before_add:
            self.before_add(target)
        path = self.live / target.relative_to('/etc/nginx')
        path.parent.mkdir(exist_ok=True)
        PREP['create_file'](path, content)


class PrepareFiles(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='hd-v2-nginx-')
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.root = self.base / 'persistent'
        self.live = self.base / 'live'
        for root in (self.root, self.live):
            for name in SECTIONS:
                (root / name).mkdir(parents=True)
        (self.root / 'rollback').mkdir()
        self.candidate = self.root / 'bundles' / 'reviewed-v2'
        for section in SECTIONS:
            (self.candidate / section).mkdir(parents=True)
        for root in (self.root, self.live):
            content = f'include {self.live}/hd-domains/public.conf;\n'
            (root / 'conf.d/default.conf').write_text(content)
            (root / 'hd-domains/public.conf').write_text('server { listen 127.0.0.1:14777; location / { return 200 old; } }\n')
        self.gateway = Gateway(self.base, self.live)
        self.baseline = PREP['tree'](self.live)
        (self.candidate / 'conf.d/default.conf').write_text(
            f'geo $country {{ default ""; include {self.live}/hd-analytics-geo/country.conf; }}\n'
            + self.baseline[next(path for path in self.baseline if path.name == 'default.conf')].decode()
            + ''.join(f'include {self.live}/{path};\n' for path in sorted(ADDITIONS)))
        shutil.copyfile(self.live / 'hd-domains/public.conf', self.candidate / 'hd-domains/public.conf')
        for path in ADDITIONS:
            (self.candidate / path).write_bytes(b'# Distinct reviewed candidate include.\n')

    def prepare(self):
        return PREP['prepare'](self.root, self.candidate, self.gateway, START)

    def point_to_mounted(self):
        mounts = [{'Type': 'bind', 'Source': str(self.root / section), 'Destination': '/etc/nginx/' + section}
                  for section in SECTIONS]
        self.gateway.live = self.root
        self.gateway.mounts = mounts

    @unittest.skipUnless(shutil.which('nginx'), 'native Nginx is required for real validation')
    def test_stages_with_old_config_and_standard_reload_rollback_layout(self):
        result = self.prepare()
        self.assertFalse(result['reloaded'])
        self.assertEqual(result['proxyStartedAt'], START)
        self.assertEqual(self.gateway.additions, [Path('/etc/nginx') / item for item in sorted(ADDITIONS)] + [GEO])
        self.assertEqual(self.gateway.geo(), EMPTY_GEO)
        self.assertEqual(self.gateway.validations, [self.gateway.nginx_command() + ['-t']] * 2)
        rollback = Path(result['rollback'])
        archive = Path(result['original'])
        self.assertEqual(PREP['tree'](archive / 'original-live'), self.baseline)
        self.assertEqual(PREP['tree'](archive / 'original-persistent'), self.baseline)
        new_layout = {**self.baseline, **dict.fromkeys(ADDITIONS, PLACEHOLDER)}
        self.assertEqual(PREP['tree'](rollback), new_layout)
        self.assertEqual(PREP['tree'](self.live), new_layout)
        self.assertEqual(PREP['tree'](self.root), new_layout)

        # Ordinary same-file-set apply and rollback use the existing script's copy path.
        copy = PREP['GATEWAY']['copy_config']
        for source in (self.candidate, rollback):
            for section in SECTIONS:
                copy(source / section, self.live / section)
            self.gateway.validate(self.gateway.nginx_command())
        self.assertEqual(PREP['tree'](self.live), new_layout)
        self.assertTrue((archive / 'prepared.json').exists())

    def test_mounted_writes_only_the_shared_files_and_geo_and_retries_idempotently(self):
        self.point_to_mounted()
        first = self.prepare()
        second = self.prepare()
        self.assertEqual(self.gateway.additions, [GEO])
        self.assertEqual(first['baselineSha256'], second['baselineSha256'])
        self.assertEqual(PREP['tree'](Path(first['rollback'])), PREP['tree'](Path(second['rollback'])))

    def test_retries_partial_preparation_without_replacing_an_existing_placeholder(self):
        blocked = sorted(ADDITIONS)[1]

        def broken(path):
            if path == Path('/etc/nginx') / blocked:
                raise OSError('synthetic stop')

        self.gateway.before_add = broken
        with self.assertRaisesRegex(OSError, 'synthetic stop'):
            self.prepare()
        first = self.live / sorted(ADDITIONS)[0]
        previous = first.stat().st_ino
        self.gateway.before_add = None
        result = self.prepare()
        self.assertEqual(first.stat().st_ino, previous)
        self.assertEqual(PREP['tree'](Path(result['rollback'])), PREP['tree'](self.live))

    def test_existing_non_placeholder_and_unexpected_candidate_file_are_rejected(self):
        path = self.root / sorted(ADDITIONS)[0]
        path.write_text('keep this content')
        with self.assertRaisesRegex(ValueError, 'non-placeholder'):
            self.prepare()
        self.assertEqual(path.read_text(), 'keep this content')
        path.unlink()
        (self.candidate / 'hd-domains/unrelated.conf').write_text('extra')
        with self.assertRaisesRegex(ValueError, 'exact v2 file-set'):
            self.prepare()
        self.assertFalse(self.gateway.additions)

    def test_no_existing_geo_table_replacement_and_no_mixed_mounts(self):
        self.point_to_mounted()
        self.gateway.mounts.pop()
        with self.assertRaisesRegex(ValueError, 'Mixed'):
            self.prepare()
        self.gateway.mounts = []
        self.gateway.live = self.live
        path = self.live / GEO.relative_to('/etc/nginx')
        path.parent.mkdir()
        path.write_text('192.0.2.0/24 ZZ;\n')
        with self.assertRaisesRegex(ValueError, 'differs from the reviewed disabled'):
            self.prepare()
        self.assertEqual(path.read_text(), '192.0.2.0/24 ZZ;\n')
        self.assertFalse(self.gateway.additions)

    def test_refuses_different_started_at_and_detects_change_during_preparation(self):
        self.gateway.started = 'other-start'
        with self.assertRaisesRegex(ValueError, 'stopped or changed'):
            self.prepare()
        self.assertFalse(self.gateway.additions)
        self.gateway.started = START

        def restart_after_geo(path):
            if path == GEO:
                self.gateway.started = 'second-start'

        self.gateway.before_add = restart_after_geo
        with self.assertRaisesRegex(ValueError, 'stopped or changed'):
            self.prepare()
        self.assertEqual(PREP['original_files'](PREP['tree'](self.live)), self.baseline)

    def test_uses_the_existing_exclusive_reload_lock(self):
        with PREP['lock'](self.root), self.assertRaises(BlockingIOError):
            self.prepare()
        self.assertFalse(self.gateway.additions)

    def test_geo_shell_rejects_symlink_parents_and_special_files_before_reading(self):
        gateway = PREP['DockerGateway']('fixture')
        gateway.run = lambda *arguments: subprocess.run(arguments[4:], check=True, capture_output=True, timeout=2).stdout
        directory = self.base / 'geo'
        directory.mkdir()
        linked = self.base / 'linked'
        linked.symlink_to(directory, target_is_directory=True)
        regular = directory / 'country.conf'
        regular.write_bytes(EMPTY_GEO)
        pipe = directory / 'named-pipe'
        os.mkfifo(pipe, 0o600)
        for target in (linked / regular.name, pipe):
            with patch.dict(gateway.geo.__globals__, {'GEO': PurePosixPath(target)}), \
                 self.subTest(target=target), self.assertRaises(subprocess.CalledProcessError):
                gateway.geo()


if __name__ == '__main__':
    unittest.main()
