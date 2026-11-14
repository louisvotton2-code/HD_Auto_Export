import importlib.util
from pathlib import Path
import unittest

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
    def test_no_config_injection(self):
        with self.assertRaises(ValueError):m.gateway_files(Path(__file__).parent,web_host='web;bad',public_api_host='api',admin_api_host='api')
        with self.assertRaises(ValueError):m.slot_config(self.config(),slot='bad',release='a'*40,api_ip='172.20.0.21',web_ip='172.20.0.22',mode_root='/srv')


class Assets(unittest.TestCase):
    def test_collision_does_not_replace_old_assets(self):
        import tempfile
        spec=importlib.util.spec_from_file_location('assets',Path(__file__).parent/'production/immutable-assets.py')
        assets=importlib.util.module_from_spec(spec);spec.loader.exec_module(assets)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();source=root/'source';source.mkdir();dest=root/'dest'
            (source/'hash.js').write_text('previous');assets.merge(source,dest)
            (source/'hash.js').write_text('changed')
            with self.assertRaises(ValueError):assets.merge(source,dest)
            self.assertEqual((dest/'hash.js').read_text(),'previous')

if __name__=='__main__':unittest.main()
