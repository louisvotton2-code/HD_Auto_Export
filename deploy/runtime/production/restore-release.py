#!/usr/bin/env python3
"""Restore a reviewed production backup into a NEW logical database; never switches traffic.
Default is a read-only preflight. --execute additionally requires an explicit PM/CI gate.
Run on the existing Linux host; dump, media, credentials and evidence stay on that host.
"""
import argparse, fcntl, hashlib, importlib.util, json, os, pathlib, re, secrets, stat, subprocess, sys, tarfile
from datetime import datetime, timezone
HERE=pathlib.Path(__file__).resolve().parent
# Preflight must not make its clean release checkout dirty by importing runtime.py.
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('hd_runtime',HERE.parent/'runtime.py')
runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
os.umask(0o077)
SHA=re.compile(r'[a-f0-9]{40}')
MEDIA=re.compile(r'[0-9a-f-]{36}(?:\.thumb)?\.webp')

def private_file(path):
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_mode&0o077 or info.st_uid!=os.getuid():
        raise ValueError('Expected a private operator-owned regular file')
    return path

def gate(path, sha, backup_hash):
    value=json.loads(private_file(path).read_text())
    expected={'mainSha':sha,'pmApprovedSha':sha,'ciVerifiedSha':sha,'backupSha256':backup_hash,
              'action':'restore-new-production-database','sourceDatabase':'hd_auto'}
    if any(value.get(k)!=v for k,v in expected.items()):
        raise ValueError('PM/main/CI/backup gate does not match this exact operation')
    at=datetime.fromisoformat(value['approvedAt'])
    age=(datetime.now(timezone.utc)-at).total_seconds()
    if at.utcoffset() is None or not 0<=age<=86400:raise ValueError('Approval gate is expired or invalid')
    return value

def validate_backup(backup):
    if backup.is_symlink() or not backup.is_dir() or backup.stat().st_mode&0o077:
        raise ValueError('Backup directory must be private and not a symlink')
    manifest=json.loads(private_file(backup/'manifest.json').read_text())
    if manifest.get('format')!=1 or manifest.get('sourceDatabase')!='hd_auto' or manifest.get('profile','default')!='default':
        raise ValueError('Only a fresh real production hd_auto backup is accepted')
    age=(datetime.now(timezone.utc)-datetime.fromisoformat(manifest['createdAt'])).total_seconds()
    if not 0<=age<=86400:raise ValueError('Use a fresh maintenance-window backup')
    for name,key in [('database.dump','databaseSha256'),('media.tar','mediaTarSha256')]:
        if runtime.digest(private_file(backup/name))!=manifest[key]:raise ValueError('Backup checksum mismatch')
    with tarfile.open(backup/'media.tar') as archive:
        seen=set()
        for member in archive:
            if not member.isfile() or not MEDIA.fullmatch(member.name) or member.name in seen:
                raise ValueError('Unexpected media archive entry')
            seen.add(member.name)
            with archive.extractfile(member) as stream:
                h=hashlib.file_digest(stream,'sha256').hexdigest()
            if h!=manifest['media'].get(member.name):raise ValueError('Media member checksum mismatch')
        if seen!=set(manifest['media']):raise ValueError('Media manifest mismatch')
    return manifest

def docker(*args,input=None):
    result=subprocess.run(['docker',*args],input=input,capture_output=True,check=False)
    if result.returncode:raise ValueError('Docker operation failed; private state retained; credentials were not printed')
    return result.stdout

def postgres_container():
    if os.environ.get('DOCKER_HOST') or os.environ.get('DOCKER_CONTEXT'):raise ValueError('Clear Docker host/context overrides')
    context=docker('context','inspect').decode()
    if not json.loads(context)[0]['Endpoints']['docker']['Host'].startswith('unix://'):raise ValueError('Only the local Docker socket is allowed')
    ids=docker('ps','--filter','label=com.docker.compose.project=hd-auto','--filter','label=com.docker.compose.service=postgres','-q').decode().split()
    if len(ids)!=1:raise ValueError('Expected exactly one existing production postgres container')
    cid=ids[0];info=json.loads(docker('inspect',cid))[0]
    if info.get('NetworkSettings',{}).get('Ports',{}).get('5432/tcp') is not None:raise ValueError('Production PostgreSQL must have no host port')
    return cid,info

def psql(cid, database, sql):
    return docker('exec','-i',cid,'psql','-X','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-Atq',input=sql.encode()).decode().strip()

def drained(cid):
    live=docker('ps','--filter','label=com.docker.compose.project=hd-auto','--format','{{.Label "com.docker.compose.service"}}').decode().split()
    if any(s in live for s in ['api','worker','migrate']):raise ValueError('All application and maintenance writers must be stopped')
    if psql(cid,'hd_auto',"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend';")!='0':
        raise ValueError('Production source database still has clients')

FINGERPRINT="""CREATE TEMP TABLE release_fingerprints(name text PRIMARY KEY,digest text,rows bigint);
DO $$ DECLARE item record; h text; n bigint; BEGIN
 FOR item IN SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')),count(*) FROM %I.%I t',item.schemaname,item.tablename) INTO h,n;
  INSERT INTO release_fingerprints VALUES(item.schemaname||'.'||item.tablename,h,n);
 END LOOP;
 FOR item IN SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,sequencename LOOP
  EXECUTE format('SELECT md5(jsonb_build_object(''last_value'',last_value,''is_called'',is_called)::text) FROM %I.%I',item.schemaname,item.sequencename) INTO h;
  INSERT INTO release_fingerprints VALUES(item.schemaname||'.'||item.sequencename||'#sequence',h,1);
 END LOOP;
END $$;
SELECT jsonb_agg(to_jsonb(t) ORDER BY name) FROM release_fingerprints t;"""

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env',type=pathlib.Path,required=True)
    parser.add_argument('--backup',type=pathlib.Path,required=True)
    parser.add_argument('--main-sha',required=True)
    parser.add_argument('--gate',type=pathlib.Path)
    parser.add_argument('--execute',action='store_true')
    args=parser.parse_args()
    if sys.platform!='linux' or os.getuid()!=0:raise ValueError('Run as root on the existing production Linux host')
    if not SHA.fullmatch(args.main_sha):raise ValueError('A full reviewed main commit is required')
    source_sha=subprocess.run(['git','-C',str(HERE),'rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip()
    dirty=subprocess.run(['git','-C',str(HERE),'status','--porcelain','--untracked-files=normal'],capture_output=True,text=True,check=True).stdout
    if source_sha!=args.main_sha or dirty:raise ValueError('Use a clean checkout of the exact reviewed main SHA')
    values,root=runtime.config(private_file(args.env));runtime.validate_production(values,root)
    if root!=pathlib.Path('/srv/hd-auto/data/current') or values['HD_DEPLOYMENT_ENV']!='production' or values['RELEASE_ID']!=args.main_sha:
        raise ValueError('Only the existing stable production root and exact release identity are accepted')
    database=values['HD_DATABASE_NAME'];role=database+'_app'
    if database!='hd_release_'+args.main_sha[:16]:raise ValueError('New database must derive from this exact main SHA')
    backup=args.backup.resolve()
    if backup.parent!=pathlib.Path('/srv/hd-auto/backups'):raise ValueError('Use the existing host backup root')
    manifest=validate_backup(backup)
    cid,info=postgres_container()
    mounts=[m for m in info['Mounts'] if m['Destination']=='/var/lib/postgresql']
    if len(mounts)!=1 or mounts[0]['Source']!=values['POSTGRES_DATA_ROOT']:raise ValueError('Existing physical PostgreSQL path mismatch')
    # Both this controller and runtime.py use the SAME host operation lock.
    with (root/'.operation.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if psql(cid,'postgres',f"SELECT count(*) FROM pg_database WHERE datname='{database}';")!='0' or psql(cid,'postgres',f"SELECT count(*) FROM pg_roles WHERE rolname='{role}';")!='0':
            raise ValueError('Target database/role already exists; never overwrite or retry blindly')
        media=pathlib.Path(values['MEDIA_DATA_ROOT']);secretroot=pathlib.Path(values['RELEASE_SECRETS_ROOT'])
        if media.exists() or secretroot.exists() or (backup/'release-restore-proof.json').exists():raise ValueError('Target directories/proof must be new')
        drained(cid)
        source=json.loads(psql(cid,'hd_auto',FINGERPRINT))
        source_ledger=[t for t in source if t['name']=='drizzle.__drizzle_migrations']
        if len(source_ledger)!=1 or source_ledger[0]['rows']!=4:raise ValueError('This initial release requires the inventoried legacy schema4 source')
        if not args.execute:
            print(json.dumps({'status':'read-only-preflight','sourceDatabase':'hd_auto','targetDatabase':database,'sourceTables':len(source),'mediaVerified':len(manifest['media']),'executed':False}))
            return
        if not args.gate:raise ValueError('--execute requires the exact externally approved main/CI/backup gate')
        gate(args.gate,args.main_sha,manifest['databaseSha256'])
        uid,gid=runtime.validate_operator(values)
        # Preserve all diagnostics after failure. No automatic DROP, overwrite or writer restart.
        media.mkdir(mode=0o700,parents=True);os.chown(media,uid,gid)
        secretroot.mkdir(mode=0o700,parents=True)
        password=secrets.token_hex(32)
        for name,value in [('app_db_password',password),('public_cache_password',secrets.token_hex(32)),('ssr_service_secret',secrets.token_hex(32))]:
            path=secretroot/name
            with path.open('x') as f:f.write(value+'\n')
            path.chmod(0o600);os.chown(path,uid,gid)
        psql(cid,'postgres',f"CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '{password}';\nCREATE DATABASE {database} OWNER {role};\nREVOKE ALL ON DATABASE {database} FROM PUBLIC;")
        old_access=psql(cid,'hd_auto',f"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m','S') AND CASE WHEN c.relkind='S' THEN has_sequence_privilege('{role}',c.oid,'SELECT,USAGE,UPDATE') ELSE has_table_privilege('{role}',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') END;")
        old_definers=psql(cid,'hd_auto',f"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','drizzle') AND p.prosecdef AND has_function_privilege('{role}',p.oid,'EXECUTE');")
        members=psql(cid,'postgres',f"SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='{role}';")
        if old_access!='0' or old_definers!='0' or members!='0':
            raise ValueError('New role can access retained source data or inherits another identity; keep writers stopped')
        with (backup/'database.dump').open('rb') as dump:
            result=subprocess.run(['docker','exec','-i',cid,'pg_restore','-U','postgres','-d',database,'--role='+role,'--no-owner','--no-acl','--exit-on-error','--single-transaction'],stdin=dump,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            if result.returncode:raise ValueError('New database restore failed; keep isolated state for diagnosis')
        restored=json.loads(psql(cid,database,FINGERPRINT))
        if restored!=source:raise ValueError('Full source/restore table fingerprints differ; do not migrate or switch')
        # Verify a real extracted copy, then retain it privately beside the backup, never in serving media.
        restored_media=backup/'restore-verified-media';restored_media.mkdir(mode=0o700)
        with tarfile.open(backup/'media.tar') as archive:
            for member in archive:
                dest=restored_media/member.name
                with archive.extractfile(member) as src,dest.open('xb') as dst:
                    while data:=src.read(1024*1024):dst.write(data)
                if runtime.digest(dest)!=manifest['media'][member.name]:raise ValueError('Extracted media verification failed')
        drained(cid)
        if json.loads(psql(cid,'hd_auto',FINGERPRINT))!=source:raise ValueError('Source changed during restore; keep writers stopped')
        proof={'status':'restored-before-migration','mainSha':args.main_sha,'sourceDatabase':'hd_auto','targetDatabase':database,'role':role,'backupSha256':manifest['databaseSha256'],'retainedTables':source,'mediaVerified':len(manifest['media']),'newServingMediaEmpty':not any(media.iterdir()),'createdAt':datetime.now(timezone.utc).isoformat(),'trafficSwitched':False}
        with (backup/'release-restore-proof.json').open('x') as f:json.dump(proof,f,indent=2);f.write('\n')
        print('New logical database restored and all source tables/media verified. Writers remain stopped. Migration, reset and traffic switch are separate steps.')

if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,OSError,subprocess.CalledProcessError,json.JSONDecodeError):
        print('Release restore refused or failed. Keep maintenance and private diagnostics; no automatic rollback or secrets printed.',file=sys.stderr);sys.exit(1)
