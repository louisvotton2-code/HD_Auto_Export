import importlib.util
import subprocess
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('slots',Path(__file__).parent/'production/release-slots.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Slots(unittest.TestCase):
    def config(self):
        return {'services':{'api':{'image':'old','ports':['3000:3000'],'depends_on':{'postgres':{}},'environment':{'TRUST_PROXY':'172.20.0.2/32,172.20.0.4/32'},'networks':{'default':{},'egress':{}}},'web':{'environment':{},'networks':{'default':{'ipv4_address':'172.20.0.4'}}}},'networks':{'default':{'name':'hd_data','internal':True},'egress':{'name':'hd_egress'}},'secrets':{}}
    def test_no_new_database_or_public_ports_and_mode_bound(self):
        value=m.slot_config(self.config(),slot='green',release='a'*40,api_ip='172.20.0.21',web_ip='172.20.0.22',mode_root='/srv/hd-auto/staging/slots/green')
        self.assertEqual(set(value['services']),{'api-green','web-green'})
        api=value['services']['api-green'];web=value['services']['web-green']
        self.assertNotIn('ports',api);self.assertNotIn('depends_on',api)
        self.assertEqual(api['environment']['HD_SSR_SERVICE_PEERS'],'172.20.0.22/32')
        self.assertEqual(api['environment']['TRUST_PROXY'],'172.20.0.2/32,172.20.0.22/32')
        self.assertEqual(web['environment']['VEHICLE_API_BASE_URL'],'http://api-green:3320')
        self.assertEqual(api['volumes'][-1]['target'],'/run/hd-serving')
        self.assertTrue(value['networks']['default']['external'])
    def test_gateway_keeps_public_reads_and_freezes_only_admin_api(self):
        files=m.gateway_files(Path(__file__).parent,web_host='web-green',public_api_host='api-green',admin_api_host='api',freeze_admin=True)
        text=files['default.conf'];boundary=text.rindex('    server_name admin.hongdingauto.com;')
        self.assertNotIn('location /api/ {\n        return 503;',text[:boundary])
        self.assertIn('location /api/ {\n        return 503;',text[boundary:])
        self.assertEqual(text.count('root /srv/hd-assets;'),2)
        self.assertIn('proxy_set_header X-HD-SSR-Key',files['hd-domains/api-proxy.conf'])
        self.assertNotIn('http://web:3000',text)

    def test_public_route_includes_follow_selected_slot(self):
        source = Path(__file__).parent
        for slot, old_slot in (('blue', 'green'), ('green', 'blue')):
            with self.subTest(slot=slot):
                files = m.gateway_files(source, web_host=f'web-{slot}', public_api_host=f'api-{slot}',
                                        admin_api_host=f'api-{old_slot}', freeze_admin=True)
                contact = files['hd-domains/analytics-contact-count.conf']
                self.assertIn(f'set $api http://api-{slot}:3320;', contact)
                self.assertNotIn(f'http://api-{old_slot}:3320', contact)
                for include in ('sitemap.conf', 'external-media-report.conf'):
                    self.assertIn(f'set $web http://web-{slot}:3000;', files[f'hd-domains/{include}'])

    def test_apex_primary_and_freeze_use_separate_web_and_admin_tls_and_upstreams(self):
        for freeze in (False, True):
            with self.subTest(freeze=freeze):
                text = m.gateway_files(Path(__file__).parent, web_host='web-blue', public_api_host='api-blue',
                                       admin_api_host='api-green', freeze_admin=freeze,
                                       website_origin=m.APEX_WEBSITE_ORIGIN)['default.conf']
                boundary = text.rindex('    server_name admin.hongdingauto.com;')
                website, admin = text[:boundary], text[boundary:]
                self.assertEqual(website.count('server_name hongdingauto.com;'), 2)
                self.assertIn('/run/tls/apex/current/server.crt;', website)
                self.assertIn('/run/tls/admin/current/server.crt;', admin)
                self.assertNotIn('/run/tls/current/', text)
                self.assertIn('http://api-blue:3320', website)
                self.assertIn('http://api-green:3320', admin)
                self.assertNotIn('http://api-green:3320', website)
                self.assertEqual('location /api/ {\n        return 503;' in admin, freeze)

    def test_apex_tls_keepalive_is_scoped_and_preserves_shared_policy(self):
        source=Path(__file__).parent
        baseline=m.gateway_files(source,web_host='web-blue',public_api_host='api-blue',admin_api_host='api-blue')
        for freeze in (False,True):
            result=m.gateway_files(source,web_host='web-blue',public_api_host='api-blue',admin_api_host='api-blue',freeze_admin=freeze,website_origin=m.APEX_WEBSITE_ORIGIN)
            text=result['default.conf']
            start=text.index('server {\n    # Explicit server override')
            end=text.index('\n}',start)
            apex=text[start:end]
            self.assertIn('server_name hongdingauto.com;',apex)
            self.assertIn('listen 8443 ssl;',apex)
            self.assertEqual(apex.count('keepalive_timeout 60s;'),1)
            shared=result['hd-domains/edge-server.conf']
            for line in shared.splitlines():
                if line and not line.startswith('#'):
                    expected=line.replace('keepalive_timeout 15s;', 'keepalive_timeout 60s;')
                    self.assertIn('    '+expected,apex)
            self.assertIn('access_log /dev/stdout hd_edge;',apex)
            self.assertEqual(text.count('keepalive_timeout 60s;'),1)
            self.assertEqual(result['hd-domains/edge-server.conf'],baseline['hd-domains/edge-server.conf'])
            self.assertIn('keepalive_timeout 15s;',result['hd-domains/edge-server.conf'])
            self.assertEqual(set(result),set(baseline))
            for name in ('admin.hongdingauto.com','www.hongdingauto.com'):
                pos=text.rindex('server_name '+name+';');start=text.rfind('server {',0,pos)
                self.assertIn('include /etc/nginx/hd-domains/edge-server.conf;',text[start:pos])
        self.assertNotIn('keepalive_timeout 60s;',baseline['default.conf'])

    def test_no_config_injection(self):
        with self.assertRaises(ValueError):m.gateway_files(Path(__file__).parent,web_host='web;bad',public_api_host='api',admin_api_host='api')
        with self.assertRaises(ValueError):m.slot_config(self.config(),slot='bad',release='a'*40,api_ip='172.20.0.21',web_ip='172.20.0.22',mode_root='/srv')
        for origin in ('https://www.hongdingauto.com', 'https://hongdingauto.com/', 'https://hongdingauto.com;'):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                m.gateway_files(Path(__file__).parent, web_host='web-blue', public_api_host='api-blue',
                                admin_api_host='api-blue', website_origin=origin)
    def test_html_cache_is_private_and_bound_to_the_same_release_and_web_slot(self):
        config = self.config()
        config['services']['proxy'] = {'networks': {'default': {'ipv4_address': '172.20.0.2'}}}
        config['services']['web'].update(platform='linux/amd64', user='1000:1000', logging={})
        config['services']['web']['environment']['NEXT_PUBLIC_SITE_URL'] = 'https://cars.hongdingauto.com'
        args = dict(slot='blue', release='a'*40, api_ip='172.20.0.21', web_ip='172.20.0.22',
                    mode_root='/srv/hd-auto/staging/slots/blue')
        value = m.slot_config(config, **args, html_cache_ip='172.20.0.23',
                              html_cache_secret_file='/srv/hd-auto/secrets/html-cache')
        cache = value['services']['html-cache-blue']
        self.assertEqual(cache['image'], 'hd-auto-html-cache:' + args['release'])
        self.assertEqual(cache['environment']['HD_HTML_CACHE_ORIGIN'], 'http://web-blue:3000')
        self.assertEqual(cache['environment']['HD_HTML_CACHE_SITE_HOST'], 'cars.hongdingauto.com')
        self.assertEqual(cache['environment']['HD_HTML_CACHE_PROTOCOL'], '2')
        self.assertEqual(cache['environment']['HD_HTML_CACHE_EDGE_IP'], '172.20.0.2')
        self.assertIn('html_cache_secret', value['services']['web-blue']['secrets'])
        self.assertEqual(cache['networks']['default']['aliases'], ['html-cache-blue'])
        self.assertNotIn('ports', cache)
        self.assertNotIn('html_cache_secret', value['services']['api-blue'].get('secrets', []))
        with self.assertRaises(ValueError):
            m.slot_config(config, **args, html_cache_ip='172.20.0.22',
                          html_cache_secret_file='/srv/hd-auto/secrets/html-cache')
        with self.assertRaises(ValueError):
            m.slot_config(config, **args, html_cache_ip='172.20.0.23')
        config['services']['web']['environment']['NEXT_PUBLIC_SITE_URL'] = m.APEX_WEBSITE_ORIGIN
        with self.assertRaisesRegex(ValueError, 'analytics'):
            m.slot_config(config, **args, html_cache_ip='172.20.0.23',
                          html_cache_secret_file='/srv/hd-auto/secrets/html-cache')
        config['services']['api']['environment']['ANALYTICS_ORIGINS'] = m.APEX_WEBSITE_ORIGIN
        apex = m.slot_config(config, **args, html_cache_ip='172.20.0.23',
                             html_cache_secret_file='/srv/hd-auto/secrets/html-cache',
                             html_cache_protocol='3')['services']
        self.assertEqual(apex['html-cache-blue']['environment']['HD_HTML_CACHE_SITE_HOST'], 'hongdingauto.com')
        self.assertEqual(apex['html-cache-blue']['environment']['HD_HTML_CACHE_PROTOCOL'], '3')
        self.assertEqual(apex['api-blue']['environment']['ANALYTICS_ORIGINS'], m.APEX_WEBSITE_ORIGIN)
        with self.assertRaisesRegex(ValueError, 'cache protocol'):
            m.slot_config(config, **args, html_cache_protocol='3')

    def test_gateway_enables_html_cache_only_for_explicit_web_slot(self):
        args = dict(web_host='web-green', public_api_host='api-green', admin_api_host='api-blue')
        source = Path(__file__).parent
        inactive = m.gateway_files(source, **args)['default.conf']
        active = m.gateway_files(source, **args, html_cache_host='html-cache-green')['default.conf']
        self.assertNotIn('http://html-cache', inactive)
        self.assertIn('http://html-cache-green:3010', active)
        self.assertIn('error_page 419 502 504 = @hd_home_dynamic;', active)
        self.assertEqual(active.rsplit('    server_name admin.hongdingauto.com;', 1)[1],
                         inactive.rsplit('    server_name admin.hongdingauto.com;', 1)[1])
        with self.assertRaises(ValueError):
            m.gateway_files(source, **args, html_cache_host='html-cache-blue')

    def test_browse_documents_require_matching_slot_and_shared_generation_mount(self):
        config = self.config()
        config['services']['proxy'] = {'networks': {'default': {'ipv4_address': '172.20.0.2'}}}
        web = config['services']['web']
        web.update(platform='linux/amd64', user='1000:1000', logging={})
        web['environment']['NEXT_PUBLIC_SITE_URL'] = m.APEX_WEBSITE_ORIGIN
        config['services']['api']['environment']['ANALYTICS_ORIGINS'] = m.APEX_WEBSITE_ORIGIN
        source = Path(__file__).parent
        directory = '/srv/hd-auto/staging/browse'
        for slot, rollback in (('blue', 'green'), ('green', 'blue')):
            args = dict(slot=slot, release='a'*40, api_ip='172.20.0.21', web_ip='172.20.0.22',
                        mode_root=f'/srv/hd-auto/staging/slots/{slot}', html_cache_ip='172.20.0.23',
                        html_cache_secret_file='/srv/hd-auto/secrets/html-cache')
            result = m.slot_config(config, **args, html_cache_protocol='4', browse_generation_dir=directory)
            self.assertEqual(result['services'][f'html-cache-{slot}']['environment']['HD_HTML_CACHE_PROTOCOL'], '4')
            self.assertEqual(result['services'][f'api-{slot}']['environment']['PUBLIC_BROWSE_CACHE_ENABLED'], 'true')
            self.assertNotIn('PUBLIC_BROWSE_CACHE_ENABLED', result['services'][f'web-{slot}']['environment'])
            for service in result['services'].values():
                self.assertEqual(service['environment']['HD_BROWSE_GENERATION_FILE'], '/run/hd-browse/generation')
                self.assertIn({'type': 'bind', 'source': directory, 'target': '/run/hd-browse',
                               'read_only': True, 'bind': {'create_host_path': False}}, service['volumes'])
                self.assertNotIn('ports', service)
            with self.assertRaises(ValueError):
                m.slot_config(config, **args, html_cache_protocol='4')
            with self.assertRaises(ValueError):
                m.slot_config(config, **args, html_cache_protocol='3', browse_generation_dir=directory)
            gateways = dict(web_host=f'web-{slot}', public_api_host=f'api-{slot}',
                            admin_api_host=f'api-{rollback}', html_cache_host=f'html-cache-{slot}',
                            website_origin=m.APEX_WEBSITE_ORIGIN)
            for freeze in (False, True):
                gateway = m.gateway_files(source, **gateways, freeze_admin=freeze, browse_documents=True)
                self.assertIn('location ~ "^/(zh|en|ru)/(?:cars/)?$"', gateway['default.conf'])
                self.assertIn(f'http://html-cache-{slot}:3010', gateway['default.conf'])
                self.assertIn(f'http://web-{slot}:3000', gateway['default.conf'])
                self.assertNotIn(f'http://html-cache-{rollback}:3010', gateway['default.conf'])
                for include in ('web-proxy.conf', 'api-proxy.conf'):
                    self.assertIn("proxy_set_header X-HD-Browse-Generation '';",
                                  gateway['hd-domains/' + include])
                    self.assertIn('proxy_hide_header X-HD-Browse-Generation;',
                                  gateway['hd-domains/' + include])
            old = m.gateway_files(source, **gateways)['default.conf']
            self.assertIn('location ~ "^/(zh|en|ru)/$"', old)
            with self.assertRaises(ValueError):
                m.gateway_files(source, **{**gateways, 'public_api_host': f'api-{rollback}'}, browse_documents=True)

    def test_browse_generation_requires_a_matching_hold_then_creates_fresh_token(self):
        program = Path(__file__).parent/'production/browse-generation.py'
        spec = importlib.util.spec_from_file_location('browse_generation', program)
        generation = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generation)
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp).resolve()
            held = generation.change(directory, 'initialize')
            self.assertRegex(held, 'hold-[a-f0-9]{32}')
            with self.assertRaises(ValueError):
                generation.change(directory, 'enable', 'wrong')
            old = generation.change(directory, 'enable', held)
            self.assertRegex(old, '[a-f0-9]{32}')
            next_hold = generation.change(directory, 'hold', old)
            self.assertEqual(generation.change(directory, 'show'), next_hold)
            with self.assertRaises(ValueError):
                generation.change(directory, 'enable', held)
            current = generation.change(directory, 'enable', next_hold)
            self.assertNotEqual(current, old)
            self.assertEqual((directory/'generation').read_bytes(), (current+'\n').encode('ascii'))
            self.assertEqual((directory/'generation').stat().st_mode & 0o777, 0o644)

class Assets(unittest.TestCase):
    def test_collision_does_not_replace_old_assets(self):
        spec=importlib.util.spec_from_file_location('assets',Path(__file__).parent/'production/immutable-assets.py')
        assets=importlib.util.module_from_spec(spec);spec.loader.exec_module(assets)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();source=root/'source';source.mkdir();dest=root/'dest'
            (source/'hash.js').write_text('previous');assets.merge(source,dest)
            (source/'hash.js').write_text('changed')
            with self.assertRaises(ValueError):assets.merge(source,dest)
            self.assertEqual((dest/'hash.js').read_text(),'previous')

class GatewayReload(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location(
            'gateway', Path(__file__).parent/'production/gateway-reload.py'
        )
        self.gateway = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.gateway)

    def test_media_config_used_for_reload_and_rollback(self):
        media = '/etc/nginx/nginx-media-main.conf'
        checked = ['docker', 'exec', self.gateway.PROXY, 'nginx', '-c', media]
        title = f'nginx: master process nginx -c {media} -g daemon off;\0'.encode()
        inspected = b'[{"State":{"StartedAt":"original"},"Mounts":[]}]'
        calls = []

        def run(command, **kwargs):
            if command[:4] == checked[:4]:
                calls.append(command)
                if len(calls) == 2:
                    raise subprocess.CalledProcessError(1, command)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            bundle = root/'bundles/release'
            (bundle/'conf.d').mkdir(parents=True)
            (bundle/'hd-domains').mkdir()
            with patch.object(self.gateway, 'ROOT', root), \
                 patch.object(self.gateway.os, 'getuid', return_value=0), \
                 patch.object(self.gateway, 'regular_tree'), \
                 patch.object(self.gateway.subprocess, 'check_output', side_effect=[title, inspected]), \
                 patch.object(self.gateway.subprocess, 'run', side_effect=run):
                with self.assertRaises(subprocess.CalledProcessError):
                    self.gateway.apply(bundle)

        self.assertEqual(calls, [
            checked + ['-t'], checked + ['-s', 'reload'],
            checked + ['-t'], checked + ['-s', 'reload'],
        ])

    def test_gateway_preflight_rejects_extra_files_and_pending_replace(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            new, live = root/'new', root/'live'
            new.mkdir()
            live.mkdir()
            (new/'proxy.conf').write_text('new')
            (live/'proxy.conf').write_text('old')
            for filename, message in (('extra.conf', 'file-set'), ('proxy.conf.pending', 'Unfinished')):
                extra = live/filename
                extra.write_text('fixture')
                with self.assertRaisesRegex(ValueError, message):
                    self.gateway.preflight_config(new, live)
                self.assertEqual((live/'proxy.conf').read_text(), 'old')
                extra.unlink()

    def test_default_discovered_from_live_image(self):
        title = b'nginx: master process nginx -g daemon off;\0'
        version = 'configure arguments: --conf-path=/etc/nginx/nginx.conf'
        with patch.object(self.gateway.subprocess, 'check_output', side_effect=[title, version]):
            self.assertEqual(self.gateway.nginx_command('proxy')[-2:], ['-c', '/etc/nginx/nginx.conf'])

    def test_exact_master_without_arguments_uses_default_config(self):
        title = b'nginx: master process nginx\0\0'
        version = 'configure arguments: --conf-path=/etc/nginx/nginx.conf'
        with patch.object(self.gateway.subprocess, 'check_output', side_effect=[title, version]):
            self.assertEqual(self.gateway.nginx_command('proxy')[-2:], ['-c', '/etc/nginx/nginx.conf'])

    def test_refuses_global_pid_override_even_after_daemon_off(self):
        for directives in ('pid /tmp/other.pid;', 'daemon off; pid /tmp/other.pid;'):
            title = f'nginx: master process nginx -c /etc/nginx/nginx.conf -g {directives}\0'.encode()
            with self.subTest(directives=directives), \
                 patch.object(self.gateway.subprocess, 'check_output', return_value=title):
                with self.assertRaises(ValueError):
                    self.gateway.nginx_command('proxy')

    def test_refuses_unknown_master_and_relative_config(self):
        for title in (b'entrypoint.sh\0', b'nginx: master process nginx -c conf/nginx.conf\0'):
            with self.subTest(title=title), \
                 patch.object(self.gateway.subprocess, 'check_output', return_value=title):
                with self.assertRaises(ValueError):
                    self.gateway.nginx_command('proxy')


if __name__=='__main__':unittest.main()
