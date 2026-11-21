import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest


RUNTIME = Path(__file__).resolve().parent
RELEASE = 'a' * 40
ANALYTICS = 'ANALYTICS_V2_ENABLED'
SEO = 'PUBLIC_SEO_ENABLED'
SLOTS = importlib.util.spec_from_file_location('release_slots', RUNTIME / 'production/release-slots.py')
slots = importlib.util.module_from_spec(SLOTS)
SLOTS.loader.exec_module(slots)


def render_production(flags, overlays=()):
    env = {
        'PATH': os.environ['PATH'],
        'RELEASE_ID': RELEASE,
        'SITE_ORIGIN': 'https://cars.hongdingauto.com',
        'WEB_SITE_ORIGIN': 'https://cars.hongdingauto.com',
        'ADMIN_ORIGIN': 'https://admin.hongdingauto.com',
        'SITE_INDEXABLE': 'false',
        'DATA_ROOT': '/srv/test/data',
        'POSTGRES_DATA_ROOT': '/srv/test/data/postgres',
        'MEDIA_DATA_ROOT': '/srv/test/data/media',
        'FULL_SYNC_DATA_ROOT': '/srv/test/data/sync',
        'RELEASE_SECRETS_ROOT': '/srv/test/secrets',
        'CHINACARAPI_KEY_FILE': '/srv/test/secrets/provider-key',
        'HD_DATABASE_NAME': 'hd_release_' + RELEASE[:16],
        'HD_DEPLOYMENT_ENV': 'production',
        'OPS_PUBLIC_CACHE_NAMESPACE': 'hd:test:cache',
        'PROXY_IP': '172.30.80.2',
        'WEB_IP': '172.30.80.3',
        'PROXY_SUBNET': '172.30.80.0/24',
        'PROXY_DYNAMIC_RANGE': '172.30.80.128/25',
        'PROXY_GATEWAY': '172.30.80.1',
        'APP_UID': '1000',
        'APP_GID': '1000',
        **flags,
    }
    command = ['docker', 'compose', '--env-file', os.devnull, '--profile', 'full-sync']
    for suffix in ('', '.proxy', '.media', '.domains', '.production', '.full-sync', *overlays):
        command += ['-f', str(RUNTIME / f'compose{suffix}.yaml')]
    result = subprocess.run(command + ['config', '--format', 'json'], env=env,
                            capture_output=True, text=True, check=True, timeout=10)
    return json.loads(result.stdout)


@unittest.skipUnless(shutil.which('docker'), 'Docker Compose is required to render release configuration')
class ReleaseFeatureFlags(unittest.TestCase):
    def test_disabled_by_default_and_independent_approval_in_both_slots(self):
        for flags, analytics, seo in (
            ({}, 'false', 'false'),
            ({ANALYTICS: 'true'}, 'true', 'false'),
            ({SEO: 'true'}, 'false', 'true'),
        ):
            with self.subTest(flags=flags):
                config = render_production(flags)
                services = config['services']
                self.assertEqual(services['api']['environment'][ANALYTICS], analytics)
                self.assertEqual(services['api']['environment'][SEO], seo)
                self.assertEqual(services['api']['environment']['ANALYTICS_IP_VISITS_ENABLED'], 'false')
                self.assertEqual(services['web']['build']['args'][ANALYTICS], analytics)
                self.assertEqual(services['web']['build']['args']['SITE_INDEXABLE'], 'false')
                self.assertNotIn(SEO, services['web']['environment'])
                self.assertNotIn(ANALYTICS, services['full-worker']['environment'])
                self.assertNotIn(SEO, services['full-worker']['environment'])
                self.assertEqual(services['full-worker']['command'], ['full-sync', 'serve'])
                for color, api_ip, web_ip in (
                    ('blue', '172.30.80.11', '172.30.80.12'),
                    ('green', '172.30.80.21', '172.30.80.22'),
                ):
                    rendered = slots.slot_config(config, slot=color, release=RELEASE,
                                                 api_ip=api_ip, web_ip=web_ip,
                                                 mode_root=f'/srv/test/slots/{color}')['services']
                    api = rendered[f'api-{color}']['environment']
                    web = rendered[f'web-{color}']['environment']
                    self.assertEqual((api[ANALYTICS], api[SEO]), (analytics, seo))
                    self.assertEqual((web[ANALYTICS], web['SITE_INDEXABLE']), (analytics, 'false'))

    def test_private_ingress_configuration_stays_on_api_and_proxy(self):
        config = render_production({
            'HD_ANALYTICS_GEO_ROOT': '/srv/test/geo',
            'HD_ANALYTICS_GATEWAY_SECRET_FILE': '/srv/test/secrets/geo',
            'ANALYTICS_CONTACT_ALLOWED_COUNTRIES': 'RU,KZ',
            'HD_ANALYTICS_VISIT_PEERS': '172.30.80.1/32',
            'HD_ANALYTICS_VISIT_GATEWAY_SECRET_FILE': '/srv/test/secrets/visit-gateway',
            'HD_ANALYTICS_VISIT_HASH_SECRET_FILE': '/srv/test/secrets/visit-hash',
            'HD_ANALYTICS_VISIT_SOCKET_ROOT': '/run/hd-visits',
        }, overlays=('.analytics-geo', '.analytics-visits'))
        services = config['services']
        targets = {mount['target'] for mount in services['proxy']['volumes'] if mount['read_only']}
        self.assertTrue({'/etc/nginx/hd-analytics-geo', '/run/hd-visits'} <= targets)
        for name in ('web', 'full-worker'):
            self.assertFalse(any(key.startswith('ANALYTICS_') and key != ANALYTICS
                                 for key in services[name]['environment']))
        for color, ip in (('blue', 11), ('green', 21)):
            slot = slots.slot_config(config, slot=color, release=RELEASE, api_ip=f'172.30.80.{ip}',
                                     web_ip=f'172.30.80.{ip + 1}', mode_root=f'/srv/test/slots/{color}')
            api = slot['services'][f'api-{color}']
            env = api['environment']
            self.assertEqual(env[ANALYTICS], 'false')
            self.assertEqual(env['ANALYTICS_IP_VISITS_ENABLED'], 'true')
            self.assertEqual(env['ANALYTICS_IP_VISIT_PEERS'], '172.30.80.1/32')
            self.assertEqual(env['ANALYTICS_CONTACT_ALLOWED_COUNTRIES'], 'RU,KZ')
            secret_names = {entry['source'] for entry in api['secrets']}
            self.assertTrue({'analytics_gateway_key', 'analytics_visit_gateway_key',
                             'analytics_visit_hash_key'} <= secret_names)

    def test_website_build_receives_analytics_before_next_build(self):
        build = (RUNTIME / 'Dockerfile').read_text().split('FROM build AS web-build\n', 1)[1]
        prefix = build.split('RUN pnpm --filter @hd/web build', 1)[0]
        self.assertIn('ARG ANALYTICS_V2_ENABLED=false\n', prefix)
        self.assertIn('ENV ANALYTICS_V2_ENABLED=$ANALYTICS_V2_ENABLED\n', prefix)
