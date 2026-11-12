import hashlib,importlib.util,io,json,os,pathlib,tarfile,tempfile,unittest
from datetime import datetime,timedelta,timezone
spec=importlib.util.spec_from_file_location('restore_release',pathlib.Path(__file__).parent/'production/restore-release.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class RestoreGuards(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.root=pathlib.Path(self.tmp.name);self.root.chmod(0o700)
  self.sha='a'*40;self.hash='b'*64;self.path=self.root/'gate.json'
  self.value={'mainSha':self.sha,'pmApprovedSha':self.sha,'ciVerifiedSha':self.sha,'backupSha256':self.hash,'sourceDatabase':'hd_auto','action':'restore-new-production-database','approvedAt':datetime.now(timezone.utc).isoformat()}
 def write_gate(self,value):self.path.write_text(json.dumps(value));self.path.chmod(0o600)
 def test_gate_binds_main_pm_ci_backup_action_and_time(self):
  self.write_gate(self.value);r.gate(self.path,self.sha,self.hash)
  for key in ['mainSha','pmApprovedSha','ciVerifiedSha','backupSha256','sourceDatabase','action']:
   self.write_gate(self.value|{key:'mismatch'})
   with self.subTest(key=key),self.assertRaises(ValueError):r.gate(self.path,self.sha,self.hash)
  self.write_gate(self.value|{'approvedAt':(datetime.now(timezone.utc)-timedelta(days=2)).isoformat()})
  with self.assertRaises(ValueError):r.gate(self.path,self.sha,self.hash)
 def test_private_files_reject_group_read_links_and_symlinks(self):
  self.write_gate(self.value);self.path.chmod(0o640)
  with self.assertRaises(ValueError):r.private_file(self.path)
  self.path.chmod(0o600);link=self.root/'link';link.symlink_to(self.path)
  with self.assertRaises(ValueError):r.private_file(link)
  link.unlink();os.link(self.path,link)
  with self.assertRaises(ValueError):r.private_file(self.path)
 def backup(self,name='11111111-1111-4111-8111-111111111111.webp'):
  dump=self.root/'database.dump';dump.write_bytes(b'synthetic dump');dump.chmod(0o600)
  media=self.root/'media.tar'
  with tarfile.open(media,'w') as archive:
   info=tarfile.TarInfo(name);info.size=4;archive.addfile(info,io.BytesIO(b'data'))
  media.chmod(0o600)
  manifest={'format':1,'sourceDatabase':'hd_auto','createdAt':datetime.now(timezone.utc).isoformat(),'databaseSha256':r.runtime.digest(dump),'mediaTarSha256':r.runtime.digest(media),'media':{name:hashlib.sha256(b'data').hexdigest()}}
  path=self.root/'manifest.json';path.write_text(json.dumps(manifest));path.chmod(0o600)
  return manifest
 def test_backup_checks_payload_hashes_and_archive_paths_before_any_restore(self):
  self.backup();self.assertEqual(len(r.validate_backup(self.root)['media']),1)
  (self.root/'database.dump').write_bytes(b'changed')
  with self.assertRaises(ValueError):r.validate_backup(self.root)
  self.backup('../outside.webp')
  with self.assertRaises(ValueError):r.validate_backup(self.root)
if __name__=='__main__':unittest.main()
