import importlib.util, os, pathlib, subprocess, sys, tempfile, unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).parent))
spec=importlib.util.spec_from_file_location('cert_install',pathlib.Path(__file__).with_name('install-domain-certificate.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class CertificateTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=pathlib.Path(self.tmp.name);self.root=self.base/'data';self.tls=self.root/'tls';self.tls.mkdir(parents=True);(self.tls/'versions'/'old').mkdir(parents=True);(self.tls/'current').symlink_to('versions/old')
  self.env=self.base/'env';self.env.write_text(f'DATA_ROOT={self.root}\nPROXY_SUBNET=172.30.83.0/24\nPROXY_DYNAMIC_RANGE=172.30.83.128/25\nPROXY_GATEWAY=172.30.83.1\nPROXY_IP=172.30.83.2\nWEB_IP=172.30.83.3\nWEB_SITE_ORIGIN=https://cars.hongdingauto.com\nADMIN_ORIGIN=https://admin.hongdingauto.com\nSITE_ORIGIN=https://cars.hongdingauto.com\n');self.cert=self.base/'cert';self.cert.write_text('test cert');self.key=self.base/'key';self.key.write_text('test key');self.calls=[]
 def run_main(self):
  args=['install-domain-certificate.py','--env',str(self.env),'--project','test-cert','--cert',str(self.cert),'--key',str(self.key)]
  with patch.object(sys,'argv',args),patch.object(m,'output',return_value=b'matched') :m.main()
 def test_failed_nginx_check_restores_prior_version(self):
  def fake(args,**kw):
   self.calls.append(args)
   if 'ps' in args:return subprocess.CompletedProcess(args,0,stdout='proxy\n')
   if '-t' in args:raise subprocess.CalledProcessError(1,args)
   return subprocess.CompletedProcess(args,0,stdout='')
  with patch.object(m,'command',side_effect=fake),self.assertRaises(subprocess.CalledProcessError):self.run_main()
  self.assertEqual(os.readlink(self.tls/'current'),'versions/old');self.assertTrue(any('reload' in c for c in self.calls))
 def test_mismatched_keys_do_not_replace_certificate(self):
  args=['install-domain-certificate.py','--env',str(self.env),'--project','test-cert','--cert',str(self.cert),'--key',str(self.key)]
  with patch.object(sys,'argv',args),patch.object(m,'command'),patch.object(m,'output',side_effect=[b'cert',b'key']),self.assertRaises(ValueError):m.main()
  self.assertEqual(os.readlink(self.tls/'current'),'versions/old')
if __name__=='__main__':unittest.main()
