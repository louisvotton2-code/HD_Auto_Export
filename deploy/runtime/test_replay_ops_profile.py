"""Render the signed replay service against the production Compose overlays."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class ReplayOpsProfile(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name).resolve()
        runtime = Path(__file__).parent.resolve()
        self.release = 'a' * 40
        self.database = 'hd_release_' + 'b' * 16
        values = {
            'RELEASE_ID': self.release,
            'DATA_ROOT': str(root / 'current'),
            'POSTGRES_DATA_ROOT': str(root / 'current/postgres'),
            'MEDIA_DATA_ROOT': str(root / 'retained-media'),
            'RELEASE_SECRETS_ROOT': str(root / 'retained-secrets'),
            'HD_DATABASE_NAME': self.database,
            'HD_DEPLOYMENT_ENV': 'production',
            'SITE_ORIGIN': 'https://example.invalid',
            'WEB_SITE_ORIGIN': 'https://cars.example.invalid',
            'ADMIN_ORIGIN': 'https://admin.example.invalid',
            'TARGET_PLATFORM': 'linux/amd64',
            'APP_UID': '15001',
            'APP_GID': '15001',
            'OPS_PUBLIC_CACHE_NAMESPACE': 'hd:catalog:production',
            'PROXY_SUBNET': '172.30.94.0/24',
            'PROXY_DYNAMIC_RANGE': '172.30.94.128/25',
            'PROXY_GATEWAY': '172.30.94.1',
            'PROXY_IP': '172.30.94.2',
            'WEB_IP': '172.30.94.3',
        }
        envfile = root / 'fixture.env'
        envfile.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
        self.env = {key: value for key, value in os.environ.items() if key not in values
                    and not key.startswith(('COMPOSE_', 'DOCKER_', 'CHINACARAPI_', 'FULL_SYNC_'))}
        self.compose = ['docker', 'compose', '--project-name', 'hd-replay-ops-fixture', '--env-file', str(envfile)]
        for name in ('compose.yaml', 'compose.proxy.yaml', 'compose.media.yaml', 'compose.domains.yaml',
                     'compose.production.yaml', 'compose.replay-ops.yaml'):
            self.compose += ['-f', str(runtime / name)]

    def test_profile_is_inactive_during_normal_service_selection(self):
        services = subprocess.check_output(self.compose + ['config', '--services'], env=self.env, text=True).splitlines()
        self.assertIn('api', services)
        self.assertNotIn('full-replay-ops', services)

    def test_replay_service_is_private_unprivileged_and_one_shot(self):
        cfg = json.loads(subprocess.check_output(self.compose + ['--profile', 'full-replay-ops',
            'config', '--format', 'json'], env=self.env, text=True))
        service = cfg['services']['full-replay-ops']
        self.assertEqual(service['profiles'], ['full-replay-ops'])
        self.assertEqual(service['image'], f'hd-auto-api:{self.release}')
        self.assertEqual(service['pull_policy'], 'never')
        self.assertEqual(service['user'], '15001:15001')
        self.assertEqual(service['entrypoint'], ['node', '/app/production/worker-entrypoint.mjs'])
        self.assertEqual(service['command'], ['full-sync', 'replay-status'])
        self.assertTrue(service['init'])
        self.assertTrue(service['read_only'])
        self.assertEqual(service['restart'], 'no')
        self.assertEqual(float(service['cpus']), 0.5)
        self.assertEqual(int(service['mem_limit']), 384 * 1024 * 1024)
        self.assertEqual(service['pids_limit'], 48)
        self.assertEqual(service['tmpfs'], ['/tmp:mode=1777,size=16777216'])
        self.assertEqual(service['cap_drop'], ['ALL'])
        self.assertEqual(service['security_opt'], ['no-new-privileges:true'])
        self.assertEqual(set(service['networks']), {'default'})
        self.assertTrue(cfg['networks']['default']['internal'])
        self.assertEqual(service['secrets'], [{'source': 'release_app_db_password', 'target': 'app_db_password'}])
        self.assertEqual(service['environment'], {
            'NODE_ENV': 'production', 'NODE_OPTIONS': '--max-old-space-size=192',
            'HD_DATABASE_NAME': self.database, 'HD_DEPLOYMENT_ENV': 'production', 'HD_RELEASE_ID': self.release,
            'HD_FULL_REPLAY_OPS': 'true', 'DB_POOL_MAX': '2', 'EXTERNAL_SYNC_MODE': 'off',
            'TRANSLATION_PROVIDER': 'disabled', 'FULL_SYNC_HEAVY_WORK_PAUSE_PERCENT': '70',
            'FULL_SYNC_CAPACITY_APPROVED_BYTES': '0',
        })
        for key in ('build', 'cap_add', 'depends_on', 'devices', 'expose', 'network_mode', 'ports', 'privileged', 'volumes'):
            with self.subTest(key=key):
                self.assertNotIn(key, service)

    def test_replay_keeps_the_explicit_percentage_and_absolute_capacity_budget(self):
        env = {**self.env, 'FULL_SYNC_HEAVY_WORK_PAUSE_PERCENT': '80',
               'FULL_SYNC_CAPACITY_APPROVED_BYTES': '340000000000'}
        cfg = json.loads(subprocess.check_output(self.compose + ['--profile', 'full-replay-ops',
            'config', '--format', 'json'], env=env, text=True))
        policy = cfg['services']['full-replay-ops']['environment']
        self.assertEqual(policy['FULL_SYNC_HEAVY_WORK_PAUSE_PERCENT'], '80')
        self.assertEqual(policy['FULL_SYNC_CAPACITY_APPROVED_BYTES'], '340000000000')


if __name__ == '__main__':
    unittest.main()
