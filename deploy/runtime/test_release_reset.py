"""Opt-in real PostgreSQL component check. Creates/drops only its own random empty DB.
HD_TEST_RESET_CONTAINER must name an existing local test container, never production.
"""
import hashlib,importlib.util,json,os,pathlib,re,secrets,subprocess,unittest
HERE=pathlib.Path(__file__).resolve().parent
class RealReset(unittest.TestCase):
 @unittest.skipUnless(os.environ.get('HD_TEST_RESET_CONTAINER'),'requires explicitly selected local test PostgreSQL')
 def test_inventory_reset_preserves_auth_fees_audit_and_rejects_wrong_gate(self):
  container=os.environ['HD_TEST_RESET_CONTAINER']
  self.assertEqual(container,'hd-local12-postgres')
  self.assertFalse(os.environ.get('DOCKER_HOST'))
  context=subprocess.run(['docker','context','inspect'],capture_output=True,text=True,check=True)
  self.assertTrue(json.loads(context.stdout)[0]['Endpoints']['docker']['Host'].startswith('unix://'))
  db='hd_release_'+secrets.token_hex(8)
  def sql(text,database=db,extra=(),check=True):
   result=subprocess.run(['docker','exec','-i',container,'psql','-X','-U','hd_local','-d',database,'-v','ON_ERROR_STOP=1','-Atq',*extra],input=text,text=True,capture_output=True)
   if check:self.assertEqual(result.returncode,0,result.stderr)
   return result
  sql('CREATE DATABASE '+db+';','postgres')
  try:
   migrations=HERE.parents[1]/'apps/api/migrations'
   entries=json.loads((migrations/'meta/_journal.json').read_text())['entries']
   sql('CREATE SCHEMA drizzle;CREATE TABLE drizzle.__drizzle_migrations(id serial primary key,hash text not null,created_at bigint);')
   hashes=[]
   for entry in entries:
    body=(migrations/(entry['tag']+'.sql')).read_text();h=hashlib.sha256(body.encode()).hexdigest();hashes.append(h)
    sql("BEGIN;\n"+body+f"\nINSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES('{h}',{entry['when']});COMMIT;")
   v='11111111-1111-4111-8111-111111111111';pub='22222222-2222-4222-8222-222222222222';media='33333333-3333-4333-8333-333333333333'
   sql(f"""INSERT INTO staff(id,name,email) VALUES('fixture','Fixture','fixture@example.invalid');
   INSERT INTO staff_accounts(id,account_id,provider_id,user_id,password) VALUES('account','fixture','credential','fixture','synthetic-only');
   INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,response,expires_at) VALUES('fixture','translation','retained',repeat('a',64),'{{"retained":true}}',now()+interval '1 day');
   INSERT INTO vehicles(id) VALUES('{v}');INSERT INTO vehicle_drafts VALUES('{v}','{{}}');
   INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES('{pub}','{v}','{{}}');
   UPDATE vehicles SET publication_state='published',published_revision_id='{pub}',published_at=now();
   INSERT INTO vehicle_localizations(vehicle_id,revision,data,bindings) VALUES('{v}',1,'{{}}','{{}}');
   INSERT INTO publication_localizations VALUES('{pub}','{{}}','{{}}','{{}}');
   INSERT INTO media_assets(id,vehicle_id,content_type,expected_size,expires_at,rights) VALUES('{media}','{v}','image/webp',123,now()+interval '1 day','{{}}');
   INSERT INTO publication_media VALUES('{pub}','{media}');
   INSERT INTO publication_preview_confirmations(vehicle_id,actor_id,public_revision,fingerprint,locale) SELECT '{v}','fixture',public_content_revision,repeat('b',64),'zh' FROM vehicles WHERE id='{v}';
   INSERT INTO audit_events(id,actor_id,operation,vehicle_id,request_id) VALUES(gen_random_uuid(),'fixture','published','{v}','fixture-request');
   UPDATE home_config SET sections=jsonb_set(sections,'{{0,vehicleIds}}','["{v}"]');
   INSERT INTO translation_budget_reservations(id,characters,reserved_at) VALUES(gen_random_uuid(),10000,now());""")
   script=(HERE/'production/clear-inventory.sql').read_text()
   params=['-v','target_database='+db,'-v','main_sha='+'a'*40,'-v','expected_ledger='+','.join(hashes)]
   wrong=sql(script,extra=params+['-v','target_database=hd_auto'],check=False)
   self.assertNotEqual(wrong.returncode,0)
   self.assertEqual(sql('SELECT count(*) FROM vehicles;').stdout.strip(),'1')
   plan='44444444-4444-4444-8444-444444444444'
   sql(f"INSERT INTO translation_plans(id,vehicle_id,actor_id,plan,source_input,created_at,expires_at) VALUES('{plan}','{v}','fixture','{{}}','{{}}',now(),now()+interval '5 minutes');")
   self.assertNotEqual(sql(script,extra=params,check=False).returncode,0)
   self.assertEqual(sql('SELECT count(*) FROM vehicles;').stdout.strip(),'1')
   sql(f"DELETE FROM translation_plans WHERE id='{plan}';")
   sql(script,extra=params)
   result=json.loads(sql("""SELECT json_build_object('vehicles',(SELECT count(*) FROM vehicles),'media',(SELECT count(*) FROM media_assets),'account',(SELECT count(*) FROM staff_accounts),'receipt',(SELECT count(*) FROM idempotency_keys),'budget',(SELECT sum(characters) FROM translation_budget_reservations),'audit',(SELECT count(*) FROM audit_events WHERE vehicle_id IS NULL),'archivedLinks',(SELECT count(*) FROM hd_release_archive.audit_vehicle_links),'immutableTriggers',(SELECT count(*) FROM pg_trigger WHERE tgname IN ('publications_immutable','publication_localizations_immutable') AND tgenabled='O'));""").stdout)
   self.assertEqual(result,{'vehicles':0,'media':0,'account':1,'receipt':1,'budget':10000,'audit':1,'archivedLinks':1,'immutableTriggers':2})
   self.assertNotEqual(sql(script,extra=params,check=False).returncode,0) # Never silently reset twice.
  finally:sql('DROP DATABASE '+db+';','postgres')
 @unittest.skipUnless(os.environ.get('HD_TEST_RESET_CONTAINER'),'requires explicitly selected local test PostgreSQL')
 def test_real_dump_restore_sequence_and_role_isolation(self):
  container=os.environ['HD_TEST_RESET_CONTAINER'];self.assertEqual(container,'hd-local12-postgres')
  self.assertFalse(os.environ.get('DOCKER_HOST'));self.assertFalse(os.environ.get('DOCKER_CONTEXT'))
  context=json.loads(subprocess.run(['docker','context','inspect'],capture_output=True,text=True,check=True).stdout)
  self.assertTrue(context[0]['Endpoints']['docker']['Host'].startswith('unix://'))
  source='hd_release_'+secrets.token_hex(8);target='hd_release_'+secrets.token_hex(8);role=target+'_app'
  def sql(body,database='postgres',check=True):
   x=subprocess.run(['docker','exec','-i',container,'psql','-X','-U','hd_local','-d',database,'-v','ON_ERROR_STOP=1','-Atq'],input=body,text=True,capture_output=True)
   if check:self.assertEqual(x.returncode,0,x.stderr)
   return x
  spec=importlib.util.spec_from_file_location('restore',HERE/'production/restore-release.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
  created=[];role_created=False
  try:
   sql('CREATE DATABASE '+source+';');created.append(source)
   sql(f'CREATE ROLE {role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;');role_created=True
   sql(f'CREATE DATABASE {target} OWNER {role};REVOKE ALL ON DATABASE {target} FROM PUBLIC;');created.append(target)
   sql("CREATE TABLE preserved(id serial PRIMARY KEY,value text);INSERT INTO preserved(value) SELECT 'synthetic' FROM generate_series(1,8);",source)
   original=json.loads(sql(r.FINGERPRINT,source).stdout)
   dump=subprocess.run(['docker','exec',container,'pg_dump','-U','hd_local','-d',source,'--format=custom','--no-owner','--no-acl'],capture_output=True,check=True).stdout
   restored=subprocess.run(['docker','exec','-i',container,'pg_restore','-U','hd_local','-d',target,'--role='+role,'--no-owner','--no-acl','--exit-on-error','--single-transaction'],input=dump,capture_output=True)
   self.assertEqual(restored.returncode,0,restored.stderr.decode())
   self.assertEqual(json.loads(sql(r.FINGERPRINT,target).stdout),original)
   self.assertEqual(sql(f"SELECT has_table_privilege('{role}','preserved','SELECT');",source).stdout.strip(),'f')
   self.assertNotEqual(sql(f'SET ROLE {role};SELECT * FROM preserved;',source,False).returncode,0)
   self.assertEqual(sql(f'SET ROLE {role};SELECT count(*) FROM preserved;',target).stdout.strip(),'8')
   sql('CREATE SCHEMA hd_release_archive AUTHORIZATION CURRENT_USER;REVOKE ALL ON SCHEMA hd_release_archive FROM PUBLIC;CREATE TABLE hd_release_archive.links(id int);',target)
   self.assertEqual(sql(f"SELECT has_schema_privilege('{role}','hd_release_archive','USAGE');",target).stdout.strip(),'f')
   self.assertNotEqual(sql(f'SET ROLE {role};SELECT * FROM hd_release_archive.links;',target,False).returncode,0)
  finally:
   for database in reversed(created):sql('DROP DATABASE '+database+';')
   if role_created:sql('DROP ROLE '+role+';')
if __name__=='__main__':unittest.main()
