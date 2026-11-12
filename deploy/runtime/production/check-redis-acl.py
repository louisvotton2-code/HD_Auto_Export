#!/usr/bin/env python3
"""Verify only an owned temporary cache container. Never accepts the production project."""
import argparse,json,pathlib,re,subprocess,os
p=argparse.ArgumentParser();p.add_argument('--container',required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
if os.environ.get('DOCKER_HOST'):raise SystemExit('Use an explicitly selected local Unix Docker context')
context=subprocess.run(['docker','context','show'],capture_output=True,text=True,check=True).stdout.strip()
context_info=json.loads(subprocess.run(['docker','context','inspect',context],capture_output=True,text=True,check=True).stdout)[0]
if not context_info['Endpoints']['docker']['Host'].startswith('unix://'):raise SystemExit('Only a local Unix Docker context is permitted')
def command(args):return subprocess.run([args[0],'--context',context,*args[1:]],capture_output=True,text=True,timeout=15)
result=command(['docker','inspect',a.container]);result.check_returncode();info=json.loads(result.stdout)[0]
container_id=info['Id']
if info['Config'].get('User','').split(':')[0] in {'','0','root'}:raise SystemExit('Cache must run as a non-root user')
labels=info['Config']['Labels'];project=labels.get('com.docker.compose.project','')
if not re.fullmatch(r'hd-rel03-cache-[a-f0-9]{16}',project) or labels.get('com.docker.compose.service')!='redis':raise SystemExit('Refusing a container outside the isolated ACL test project')
values=dict(x.split('=',1) for x in info['Config']['Env'] if '=' in x);namespace=values.get('OPS_PUBLIC_CACHE_NAMESPACE','')
if not re.fullmatch(r'hd:catalog:[a-z0-9-]{1,48}',namespace):raise SystemExit('Invalid isolated namespace')
if any(info['NetworkSettings']['Ports'].values()) or not info['HostConfig']['ReadonlyRootfs']:raise SystemExit('Cache must be private and read-only')
if info['HostConfig']['Memory']!=192*1024*1024 or info['HostConfig']['NanoCpus']!=250000000:raise SystemExit('Unexpected cache resource limits')
for net in info['NetworkSettings']['Networks'].values():
 n=command(['docker','network','inspect',net['NetworkID']]);n.check_returncode()
 if not json.loads(n.stdout)[0]['Internal']:raise SystemExit('Cache network must be internal')
cases=[('allowed-set-first',True,['SET',namespace+':slot:0','synthetic-acl-proof','PX','10000']),('allowed-get-first',True,['GET',namespace+':slot:0']),('allowed-set-last',True,['SET',namespace+':slot:63','synthetic-acl-proof','PX','10000']),('reject-slot64',False,['GET',namespace+':slot:64']),('reject-other-namespace',False,['GET','hd:unrelated:slot:0']),('reject-admin',False,['CONFIG','GET','maxmemory']),('reject-scripting',False,['EVAL','return 1','0']),('reject-ping',False,['PING'])]
proof={'project':project,'container':container_id,'scope':'isolated ACL only, not full API/cache acceptance','noHostPorts':True,'internalNetwork':True,'readOnlyRoot':True,'memoryLimitMiB':192,'redisMaxmemoryMiBConfigured':128,'cpuLimit':0.25,'cases':[]}
for name,allowed,argv in cases:
 c=command(['docker','exec',container_id,'sh','-c','REDISCLI_AUTH="$(cat /run/secrets/public_cache_password)" exec redis-cli -e --raw -h 127.0.0.1 --user hd-cache "$@"','acl-check',*argv])
 passed=c.returncode==0 if allowed else c.returncode!=0 and 'NOPERM' in c.stdout+c.stderr
 proof['cases'].append({'name':name,'expectedAllowed':allowed,'passed':passed,'exitCode':c.returncode})
# No password or ACL hash is ever returned in the proof.
c=command(['docker','exec',container_id,'redis-cli','-e','--raw','GET',namespace+':slot:0']);proof['defaultUserDisabled']=c.returncode!=0 and 'NOAUTH' in c.stdout+c.stderr
proof['pass']=all(x['passed'] for x in proof['cases']) and proof['defaultUserDisabled'];a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(proof,indent=2)+'\n');a.output.chmod(0o600)
print('Isolated cache ACL passed' if proof['pass'] else 'Isolated cache ACL failed; see private proof');raise SystemExit(0 if proof['pass'] else 1)
