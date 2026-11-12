import json,os,pathlib,runpy,subprocess,sys,tempfile,unittest
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent
class CacheAclBoundaries(unittest.TestCase):
 def test_multiline_or_control_namespace_fails_before_secret_access(self):
  for value in ['hd:catalog:valid\nuser injected on nopass ~* +@all','hd:catalog:valid\ruser injected','hd:catalog:valid\tother','hd:catalog:*','other:public:release']:
   c=subprocess.run(['sh',str(HERE/'production/redis-start.sh')],env={'PATH':os.defpath,'OPS_PUBLIC_CACHE_NAMESPACE':value},capture_output=True,text=True)
   self.assertNotEqual(c.returncode,0);self.assertIn('Invalid public cache namespace',c.stderr)
 def test_checker_refuses_production_or_root_container_before_any_exec(self):
  for project,user in [('hd-auto','501:20'),('hd-rel03-cache-'+'a'*16,'root')]:
   info={'Id':'synthetic-id','Config':{'User':user,'Labels':{'com.docker.compose.project':project,'com.docker.compose.service':'redis'}}}
   calls=[]
   def fake(args,**kw):
    calls.append(args)
    if args[1:]==['context','show']:value='synthetic-local'
    elif args[1:3]==['context','inspect']:value=json.dumps([{'Endpoints':{'docker':{'Host':'unix:///synthetic-local.sock'}}}])
    else:value=json.dumps([info])
    return subprocess.CompletedProcess(args,0,stdout=value,stderr='')
   with tempfile.TemporaryDirectory() as temp,patch.dict(os.environ,{'DOCKER_HOST':''}),patch.object(subprocess,'run',side_effect=fake),patch.object(sys,'argv',['check','--container','synthetic-name','--output',temp+'/proof.json']),self.assertRaises(SystemExit):
    runpy.run_path(str(HERE/'production/check-redis-acl.py'),run_name='__main__')
   self.assertEqual(len(calls),3);self.assertIn('inspect',calls[-1]);self.assertFalse(any('exec' in c for c in calls))
if __name__=='__main__':unittest.main()
