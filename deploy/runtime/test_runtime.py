import importlib.util, io, json, os, pathlib, subprocess, sys, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('runtime',pathlib.Path(__file__).with_name('runtime.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class RuntimeFailureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=pathlib.Path(self.temp.name);self.root=self.base/'data';self.root.mkdir()
        for sub in ['media','postgres']: (self.root/sub).mkdir()
        self.env=self.base/'runtime.env';self.env.write_text(f'DATA_ROOT={self.root}\nRELEASE_ID=test\nAPP_UID={os.getuid()}\nAPP_GID={os.getgid()}\n')
        self.backup=self.base/'backup';self.calls=[]
    def invoke(self,action='backup'):
        args=['runtime.py','--env',str(self.env),'--project','test-runtime',action,'--backup',str(self.backup)]
        with patch.object(sys,'argv',args): r.main()
    def fake(self,args,**kw):
        self.calls.append(args)
        if 'pg_dump' in args: raise subprocess.CalledProcessError(1,args)
        return subprocess.CompletedProcess(args,0,stdout='api\n' if 'ps' in args else '')
    def test_proxy_address_excluded_from_dynamic_pool(self):
        v={'PROXY_SUBNET':'172.30.80.0/24','PROXY_DYNAMIC_RANGE':'172.30.80.128/25','PROXY_GATEWAY':'172.30.80.1','PROXY_IP':'172.30.80.2','WEB_IP':'172.30.80.3'}
        r.validate_proxy(v)
        for change in [{'PROXY_DYNAMIC_RANGE':'172.30.80.0/24'},{'PROXY_IP':'172.30.80.1'},{'PROXY_IP':'172.30.81.2'},{'WEB_IP':'172.30.80.2'},{'WEB_IP':'172.30.80.130'},{'WEB_IP':'172.30.81.3'}]:
            with self.assertRaises(ValueError):r.validate_proxy({**v,**change})
    def test_partial_collision_never_stops_api(self):
        self.backup.with_name('backup.partial').mkdir()
        with patch.object(r,'run',side_effect=self.fake),self.assertRaises(FileExistsError): self.invoke()
        self.assertFalse(any('stop' in c for c in self.calls))
    def test_dump_failure_restarts_previous_api(self):
        with patch.object(r,'run',side_effect=self.fake),self.assertRaises(subprocess.CalledProcessError): self.invoke()
        self.assertTrue(any('stop' in c for c in self.calls));self.assertTrue(any('start' in c for c in self.calls))
        self.assertFalse(self.backup.exists())
    def test_uid_mismatch_rejected_before_docker(self):
        self.env.write_text(self.env.read_text().replace(f'APP_UID={os.getuid()}',f'APP_UID={os.getuid()+1}'))
        with patch.object(r,'run',side_effect=self.fake),self.assertRaises(ValueError): self.invoke()
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
