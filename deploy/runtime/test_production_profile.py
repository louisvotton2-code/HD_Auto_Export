import importlib.util,json,os,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('runtime',pathlib.Path(__file__).with_name('runtime.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class ProductionPaths(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.base=pathlib.Path(self.tmp.name).resolve();self.root=self.base/'current';self.root.mkdir()
  for name in ['postgres','media','secrets']:(self.root/name).mkdir()
  self.values={'HD_DEPLOYMENT_ENV':'production','HD_DATABASE_NAME':'hd_release_'+'a'*16,'RELEASE_ID':'a'*40,'OPS_PUBLIC_CACHE_NAMESPACE':'hd:catalog:production','POSTGRES_DATA_ROOT':str(self.root/'postgres'),'MEDIA_DATA_ROOT':str(self.base/'new-media'),'RELEASE_SECRETS_ROOT':str(self.base/'new-secrets')}
 def test_canonical_separate_release_paths_pass(self):r.validate_production(self.values,self.root)
 def test_old_data_aliases_and_missing_values_fail(self):
  changes=[{'MEDIA_DATA_ROOT':str(self.root/'media')},{'MEDIA_DATA_ROOT':str(self.root/'media')+'/../media'},{'MEDIA_DATA_ROOT':str(self.root/'media'/'new')},{'RELEASE_SECRETS_ROOT':str(self.root/'secrets'/'new')},{'RELEASE_SECRETS_ROOT':str(self.base/'new-media'/'nested')},{'POSTGRES_DATA_ROOT':str(self.base/'other-pg')},{'RELEASE_ID':'latest'},{'OPS_PUBLIC_CACHE_NAMESPACE':'hd:catalog:prod\n~*'}]
  for key in ['MEDIA_DATA_ROOT','RELEASE_SECRETS_ROOT','POSTGRES_DATA_ROOT','HD_DEPLOYMENT_ENV','HD_DATABASE_NAME']:changes.append({key:''})
  for change in changes:
   with self.subTest(change=change),self.assertRaises(ValueError):r.validate_production(self.values|change,self.root)
 def test_ancestor_symlink_cannot_reach_old_media(self):
  link=self.base/'alias';link.symlink_to(self.root,target_is_directory=True)
  with self.assertRaises(ValueError):r.validate_production(self.values|{'MEDIA_DATA_ROOT':str(link/'media')},self.root)
if __name__=='__main__':unittest.main()
