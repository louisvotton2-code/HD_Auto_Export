"""Render the real Compose layers; no daemon connection, containers or real env."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class IngestionProfile(unittest.TestCase):
    def test_rendered_worker_is_bounded_private_explicit_and_translation_disabled(self):
        runtime = Path(__file__).parent.resolve()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            values = {'RELEASE_ID': 'a' * 40, 'DATA_ROOT': str(root / 'current'),
                      'POSTGRES_DATA_ROOT': str(root / 'current/postgres'),
                      'MEDIA_DATA_ROOT': str(root / 'retained-media'),
                      'RELEASE_SECRETS_ROOT': str(root / 'retained-secrets'),
                      'HD_DATABASE_NAME': 'hd_release_' + 'b' * 16, 'HD_DEPLOYMENT_ENV': 'production',
                      'SITE_ORIGIN': 'https://example.invalid', 'WEB_SITE_ORIGIN': 'https://cars.example.invalid',
                      'ADMIN_ORIGIN': 'https://admin.example.invalid', 'TARGET_PLATFORM': 'linux/amd64',
                      'APP_UID': '15001', 'APP_GID': '15001', 'OPS_PUBLIC_CACHE_NAMESPACE': 'hd:catalog:production',
                      'PROXY_SUBNET': '172.30.94.0/24', 'PROXY_DYNAMIC_RANGE': '172.30.94.128/25',
                      'PROXY_GATEWAY': '172.30.94.1', 'PROXY_IP': '172.30.94.2', 'WEB_IP': '172.30.94.3',
                      'INGESTION_PACKAGE_ROOT': str(root / 'fixed-package'),
                      'CHINACARAPI_KEY_FILE': str(root / 'existing-provider-key')}
            envfile = root / 'fixture.env'
            envfile.write_text(''.join(k + '=' + v + '\n' for k, v in values.items()))
            env = {k: v for k, v in os.environ.items() if k not in values and not k.startswith(('COMPOSE_', 'DOCKER_'))}
            cmd = ['docker', 'compose', '--project-name', 'hd-ext06-config-fixture', '--env-file', str(envfile)]
            for name in ['compose.yaml', 'compose.proxy.yaml', 'compose.media.yaml', 'compose.domains.yaml',
                         'compose.production.yaml', 'compose.ingestion.yaml']:
                cmd += ['-f', str(runtime / name)]
            cfg = json.loads(subprocess.check_output(cmd + ['--profile', 'ingestion', '--profile', 'tools',
                                                           'config', '--format', 'json'], env=env, text=True))
        worker = cfg['services']['worker']
        self.assertEqual(worker['profiles'], ['ingestion'])
        self.assertEqual(worker['image'], 'hd-auto-api:' + 'a' * 40)
        self.assertEqual(worker['user'], '15001:15001')
        self.assertEqual(worker['entrypoint'], ['node', '/app/production/worker-entrypoint.mjs'])
        self.assertEqual(worker['command'], ['status'])
        self.assertEqual(float(worker['cpus']), .5)
        self.assertEqual(int(worker['mem_limit']), 512 * 1024 * 1024)
        self.assertTrue(worker['read_only'])
        self.assertEqual(worker['tmpfs'], ['/tmp:mode=1777,size=134217728'])
        self.assertEqual(worker['cap_drop'], ['ALL'])
        self.assertEqual(worker['restart'], 'no')
        self.assertEqual(worker['environment']['DB_POOL_MAX'], '2')
        self.assertEqual(worker['environment']['EXTERNAL_SYNC_MODE'], 'off')
        self.assertEqual(worker['environment']['TRANSLATION_PROVIDER'], 'disabled')
        self.assertNotIn('DATABASE_URL', worker['environment'])
        self.assertNotIn('AUTH_SECRET', worker['environment'])
        self.assertEqual({s['source'] for s in worker['secrets']}, {'release_app_db_password', 'chinacarapi_key'})
        self.assertEqual(len(worker['volumes']), 1)
        self.assertEqual(worker['volumes'][0]['target'], '/private/import')
        self.assertTrue(worker['volumes'][0]['read_only'])
        self.assertTrue(cfg['networks']['default']['internal'])
        self.assertFalse(cfg['networks']['worker_egress'].get('internal', False))
        self.assertEqual(worker['networks']['worker_egress']['gw_priority'], 1)
        for name in ['worker', 'api', 'postgres', 'redis']:
            self.assertFalse(cfg['services'][name].get('ports'))


if __name__ == '__main__':
    unittest.main()
