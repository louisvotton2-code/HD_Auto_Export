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
    def invoke(self,action='backup',scale=False,extra=()):
        project='hd-ops-ext02-test' if scale else 'test-runtime'
        options=['--compose-override','compose.ops-scale.yaml'] if scale else []
        if scale:
            with self.env.open('a') as env: env.write('OPS_EXT_SCALE_DATABASE=hd_ext_scale_test\nBIND_ADDRESS=127.0.0.1\n')
        args=['runtime.py','--env',str(self.env),'--project',project,*options,action,'--backup',str(self.backup),*extra]
        with patch.object(sys,'argv',args): r.main()
    def fake(self,args,**kw):
        self.calls.append(args)
        if 'pg_dump' in args: raise subprocess.CalledProcessError(1,args)
        return subprocess.CompletedProcess(args,0,stdout='api\n' if 'ps' in args else ('0\n' if any('pg_stat_activity' in v for v in args) else ''))
    def test_shell_database_override_cannot_diverge_from_selected_file(self):
        def capture(args,**kw):
            self.calls.append(args)
            self.assertNotIn('HD_DATABASE_NAME',kw['env'])
            self.assertNotIn('HD_DEPLOYMENT_ENV',kw['env'])
            return subprocess.CompletedProcess(args,0,stdout='')
        with patch.dict(os.environ,{'HD_DATABASE_NAME':'hd_release_123456789abc','HD_DEPLOYMENT_ENV':'production'}),patch.object(r,'run',side_effect=capture):
            self.invoke('validate')
    def test_production_profile_requires_database_and_identity_in_file(self):
        with patch.dict(os.environ,{'HD_DATABASE_NAME':'hd_release_123456789abc','HD_DEPLOYMENT_ENV':'production'}),patch.object(r,'run',side_effect=self.fake),self.assertRaises(ValueError):
            self.invoke('validate',extra=['--compose-override','compose.production.yaml'])
        self.assertEqual(self.calls,[])
    def test_closed_window_keeps_previous_api_stopped_even_if_dump_fails(self):
        with patch.object(r,'run',side_effect=self.fake),self.assertRaises(subprocess.CalledProcessError):
            self.invoke(extra=['--keep-stopped'])
        self.assertTrue(any('stop' in c for c in self.calls))
        self.assertFalse(any('start' in c for c in self.calls))
        self.assertFalse(self.backup.exists())
    def test_release_backup_records_exact_database_and_keeps_window_closed(self):
        database='hd_release_123456789abc'
        with self.env.open('a') as f:f.write('HD_DATABASE_NAME='+database+'\n')
        def success(args,**kw):
            self.calls.append(args)
            if 'pg_dump' in args:kw['stdout'].write(b'synthetic backup content')
            return subprocess.CompletedProcess(args,0,stdout='api\n' if 'ps' in args else ('0\n' if any('pg_stat_activity' in v for v in args) else ''))
        with patch.object(r,'run',side_effect=success):self.invoke(extra=['--keep-stopped'])
        dump=next(c for c in self.calls if 'pg_dump' in c)
        self.assertEqual(dump[dump.index('-d')+1],database)
        self.assertFalse(any('start' in c for c in self.calls))
        self.assertEqual(json.loads((self.backup/'manifest.json').read_text())['sourceDatabase'],database)
    def test_release_backup_uses_selected_media_and_refuses_remaining_clients(self):
        media=self.base/'new-media';media.mkdir()
        name='11111111-1111-4111-8111-111111111111.webp'
        (media/name).write_bytes(b'synthetic media')
        with self.env.open('a') as f:f.write('MEDIA_DATA_ROOT='+str(media)+'\n')
        def success(args,**kw):
            self.calls.append(args)
            if 'pg_dump' in args:kw['stdout'].write(b'synthetic backup')
            return subprocess.CompletedProcess(args,0,stdout='api\n' if 'ps' in args else ('0\n' if any('pg_stat_activity' in v for v in args) else ''))
        with patch.object(r,'run',side_effect=success):self.invoke(extra=['--keep-stopped'])
        self.assertEqual(set(json.loads((self.backup/'manifest.json').read_text())['media']),{name})
        self.backup=self.base/'second-backup';self.calls=[]
        def busy(args,**kw):
            self.calls.append(args)
            return subprocess.CompletedProcess(args,0,stdout='api\n' if 'ps' in args else '1\n')
        with patch.object(r,'run',side_effect=busy),self.assertRaises(ValueError):self.invoke(extra=['--keep-stopped'])
        self.assertFalse(any('pg_dump' in c or 'start' in c for c in self.calls))
    def test_release_database_refuses_physical_cluster_restore(self):
        with self.env.open('a') as f:f.write('HD_DATABASE_NAME=hd_release_123456789abc\n')
        for action in ['init','restore']:
            with patch.object(r,'run',side_effect=self.fake),self.assertRaises(ValueError):self.invoke(action)
        self.assertEqual(self.calls,[])
    def test_keep_stopped_does_not_change_other_actions(self):
        with patch.object(r,'run',side_effect=self.fake),self.assertRaises(ValueError):
            self.invoke('validate',extra=['--keep-stopped'])
        self.assertEqual(self.calls,[])
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
    @unittest.skipIf(os.getuid()==0,'scale profile requires non-root host operator')
    def test_scale_backup_with_remaining_client_does_not_dump_and_resumes_writers(self):
        def busy(args,**kw):
            self.calls.append(args)
            stdout='api\nworker\n' if 'ps' in args else '1\n' if 'psql' in args else ''
            return subprocess.CompletedProcess(args,0,stdout=stdout)
        with patch.object(r,'run',side_effect=busy),self.assertRaisesRegex(ValueError,'still has clients'):
            self.invoke(scale=True)
        self.assertEqual([c[-1] for c in self.calls if 'stop' in c],['worker','api'])
        self.assertEqual([c[-1] for c in self.calls if 'start' in c],['api','worker'])
        self.assertFalse(any('pg_dump' in c for c in self.calls))
        self.assertFalse(self.backup.exists())
    @unittest.skipIf(os.getuid()==0,'scale profile requires non-root host operator')
    def test_scale_failed_api_restart_still_attempts_worker_and_keeps_backup_error(self):
        def busy(args,**kw):
            self.calls.append(args)
            if args[-2:]==['start','api']: raise subprocess.CalledProcessError(1,args)
            stdout='api\nworker\n' if 'ps' in args else '1\n' if 'psql' in args else ''
            return subprocess.CompletedProcess(args,0,stdout=stdout)
        stderr=io.StringIO()
        with patch.object(r,'run',side_effect=busy),patch.object(sys,'stderr',stderr),self.assertRaisesRegex(ValueError,'still has clients'):
            self.invoke(scale=True)
        self.assertEqual([c[-1] for c in self.calls if 'start' in c],['api','worker'])
        self.assertIn('Failed to resume services: api',stderr.getvalue())
    def test_scale_rejects_root_operator(self):
        values={'BIND_ADDRESS':'127.0.0.1','OPS_EXT_SCALE_DATABASE':'hd_ext_scale_test'}
        with patch.object(r.os,'getuid',return_value=0),self.assertRaisesRegex(ValueError,'non-root'):
            r.scale_database(values,'hd-ops-ext02-test')
    def test_normal_restore_refuses_scale_backup_before_docker(self):
        self.backup.mkdir()
        (self.backup/'manifest.json').write_text(json.dumps({'profile':'synthetic-scale'}))
        with patch.object(r,'run',side_effect=self.fake),self.assertRaisesRegex(ValueError,'profiles must match'):
            self.invoke('restore')
        self.assertEqual(self.calls,[])
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
