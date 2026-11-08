import importlib.util, io, json, os, pathlib, subprocess, sys, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('runtime',pathlib.Path(__file__).with_name('runtime.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class RuntimeFailureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=pathlib.Path(self.temp.name);self.root=self.base/'data';self.root.mkdir()
        for sub in ['media','postgres']: (self.root/sub).mkdir()
        self.uid=os.getuid() or 1000;self.gid=os.getgid() or 1000
        self.env=self.base/'runtime.env';self.env.write_text(f'DATA_ROOT={self.root}\nRELEASE_ID=test\nAPP_UID={self.uid}\nAPP_GID={self.gid}\n')
        self.backup=self.base/'backup';self.calls=[]
    def invoke(self,action='backup'):
        args=['runtime.py','--env',str(self.env),'--project','test-runtime',action,'--backup',str(self.backup)]
        with patch.object(sys,'argv',args): r.main()
    def fake(self,args,**kw):
        self.calls.append(args)
        if 'pg_dump' in args: raise subprocess.CalledProcessError(1,args)
        return subprocess.CompletedProcess(args,0,stdout='api\n' if 'ps' in args else '')
    @unittest.skipUnless(os.getuid()==0,'requires isolated root runtime')
    def test_root_initialization_keeps_root_private_and_acme_worker_owned(self):
        newroot=self.base/'newroot';self.env.write_text(self.env.read_text().replace(str(self.root),str(newroot)))
        args=['runtime.py','--env',str(self.env),'--project','test-runtime','init']
        with patch.object(sys,'argv',args),patch.object(r,'run',return_value=subprocess.CompletedProcess([],0)):r.main()
        self.assertEqual((newroot.stat().st_uid,newroot.stat().st_mode&0o777),(0,0o700))
        acme=(newroot/'acme').stat();self.assertEqual((acme.st_uid,acme.st_gid,acme.st_mode&0o777),(self.uid,self.gid,0o700))
        secret=(newroot/'secrets'/'auth_secret').stat();self.assertEqual((secret.st_uid,secret.st_mode&0o777),(0,0o600))
    def test_proxy_address_excluded_from_dynamic_pool(self):
        v={'PROXY_SUBNET':'172.30.80.0/24','PROXY_DYNAMIC_RANGE':'172.30.80.128/25','PROXY_GATEWAY':'172.30.80.1','PROXY_IP':'172.30.80.2','WEB_IP':'172.30.80.3'}
        r.validate_proxy(v)
        for change in [{'PROXY_DYNAMIC_RANGE':'172.30.80.0/24'},{'PROXY_IP':'172.30.80.1'},{'PROXY_IP':'172.30.81.2'},{'WEB_IP':'172.30.80.2'},{'WEB_IP':'172.30.80.130'},{'WEB_IP':'172.30.81.3'}]:
            with self.assertRaises(ValueError):r.validate_proxy({**v,**change})
    def test_server_root_may_operate_for_nonroot_application(self):
        with patch.object(r.os,'getuid',return_value=0), patch.object(r.os,'getgid',return_value=0):
            self.assertEqual(r.validate_operator({'APP_UID':'1000','APP_GID':'1000'}),(1000,1000))
            with self.assertRaises(ValueError):r.validate_operator({'APP_UID':'0','APP_GID':'0'})
            with self.assertRaises(ValueError):r.validate_operator({'APP_UID':'1000','APP_GID':'0'})
    def test_nonroot_cannot_impersonate_application_identity(self):
        with patch.object(r.os,'getuid',return_value=501),patch.object(r.os,'getgid',return_value=20):
            with self.assertRaises(ValueError):r.validate_operator({'APP_UID':'1000','APP_GID':'1000'})
    def test_domain_origins_are_exact(self):
        v={'WEB_SITE_ORIGIN':'https://cars.hongdingauto.com','ADMIN_ORIGIN':'https://admin.hongdingauto.com','SITE_ORIGIN':'https://cars.hongdingauto.com'}
        r.validate_domains(v)
        for change in [{'ADMIN_ORIGIN':'http://admin.hongdingauto.com'},{'WEB_SITE_ORIGIN':'https://cars.hongdingauto.com.evil.example'},{'SITE_ORIGIN':'https://localhost:3410'}]:
            with self.assertRaises(ValueError):r.validate_domains({**v,**change})
    def test_partial_collision_never_stops_api(self):
        self.backup.with_name('backup.partial').mkdir()
        with patch.object(r,'run',side_effect=self.fake),self.assertRaises(FileExistsError): self.invoke()
        self.assertFalse(any('stop' in c for c in self.calls))
    def test_dump_failure_restarts_previous_api(self):
        with patch.object(r,'run',side_effect=self.fake),self.assertRaises(subprocess.CalledProcessError): self.invoke()
        self.assertTrue(any('stop' in c for c in self.calls));self.assertTrue(any('start' in c for c in self.calls))
        self.assertFalse(self.backup.exists())
    def test_uid_mismatch_rejected_before_docker(self):
        self.env.write_text(self.env.read_text().replace(f'APP_UID={self.uid}',f'APP_UID={self.uid+1}'))
        with patch.object(r.os,'getuid',return_value=self.uid),patch.object(r.os,'getgid',return_value=self.gid),patch.object(r,'run',side_effect=self.fake),self.assertRaises(ValueError): self.invoke()
        self.assertEqual(self.calls,[])
    def test_empty_compose_ps_newline_allows_clean_restore(self):
        self.backup.mkdir();(self.backup/'database.dump').write_bytes(b'fixture')
        with r.tarfile.open(self.backup/'media.tar','w'): pass
        (self.backup/'manifest.json').write_text(json.dumps({'format':1,'databaseSha256':r.digest(self.backup/'database.dump'),'mediaTarSha256':r.digest(self.backup/'media.tar'),'media':{}}))
        def empty(args,**kw):
            self.calls.append(args);return subprocess.CompletedProcess(args,0,stdout='\n')
        with patch.object(r,'run',side_effect=empty): self.invoke('restore')
        self.assertTrue(any('pg_restore' in c for c in self.calls))
    def test_thumbnail_restore_and_link_rejection(self):
        self.backup.mkdir();(self.backup/'database.dump').write_bytes(b'fixture')
        name='01234567-0123-4123-8123-012345678901.thumb.webp';body=b'thumbnail-fixture'
        with r.tarfile.open(self.backup/'media.tar','w') as tar:
            entry=r.tarfile.TarInfo(name);entry.size=len(body);tar.addfile(entry,io.BytesIO(body))
        manifest={'format':1,'databaseSha256':r.digest(self.backup/'database.dump'),'mediaTarSha256':r.digest(self.backup/'media.tar'),'media':{name:r.hashlib.sha256(body).hexdigest()}}
        (self.backup/'manifest.json').write_text(json.dumps(manifest))
        def empty(args,**kw):return subprocess.CompletedProcess(args,0,stdout='\n')
        with patch.object(r,'run',side_effect=empty):self.invoke('restore')
        self.assertEqual((self.root/'media'/name).read_bytes(),body)
        (self.root/'media'/name).unlink()
        with r.tarfile.open(self.backup/'media.tar','w') as tar:
            entry=r.tarfile.TarInfo(name);entry.type=r.tarfile.SYMTYPE;entry.linkname='/etc/passwd';tar.addfile(entry)
        manifest['mediaTarSha256']=r.digest(self.backup/'media.tar');(self.backup/'manifest.json').write_text(json.dumps(manifest))
        with patch.object(r,'run',side_effect=empty),self.assertRaises(ValueError):self.invoke('restore')
    def test_hardlinked_media_cannot_produce_successful_backup(self):
        original=self.root/'media'/'01234567-0123-4123-8123-012345678901.webp';original.write_bytes(b'image')
        os.link(original,self.root/'media'/'01234567-0123-4123-8123-012345678902.webp')
        def empty(args,**kw):return subprocess.CompletedProcess(args,0,stdout='\n')
        with patch.object(r,'run',side_effect=empty),self.assertRaises(ValueError):self.invoke()
        self.assertFalse(self.backup.exists())
    def test_corrupt_dump_rejected_before_docker(self):
        self.backup.mkdir();(self.backup/'database.dump').write_bytes(b'corrupt')
        (self.backup/'manifest.json').write_text(json.dumps({'format':1,'databaseSha256':'invalid'}))
        with patch.object(r,'run',side_effect=self.fake),self.assertRaises(ValueError): self.invoke('restore')
        self.assertEqual(self.calls,[])
if __name__=='__main__': unittest.main()
