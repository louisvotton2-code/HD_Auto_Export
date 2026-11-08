#!/usr/bin/env python3
"""Local runtime lifecycle. Never prints credentials. Requires Python 3 + Docker Compose."""
import argparse, contextlib, fcntl, hashlib, ipaddress, json, os, pathlib, re, secrets, shutil, subprocess, sys, tarfile, tempfile
from datetime import datetime, timezone
os.umask(0o077)
HERE=pathlib.Path(__file__).resolve().parent

def run(args, **kw):
    return subprocess.run(args, check=True, **kw)
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
def config(file):
    values={}
    for line in file.read_text().splitlines():
        if line.strip() and not line.startswith('#'):
            k,v=line.split('=',1); values[k]=v
    root=pathlib.Path(values['DATA_ROOT'])
    if not root.is_absolute() or root==pathlib.Path('/') or root.is_symlink(): raise ValueError('Use an absolute, dedicated non-symlink DATA_ROOT')
    return values,root

def validate_proxy(values):
    subnet=ipaddress.IPv4Network(values['PROXY_SUBNET'])
    dynamic=ipaddress.IPv4Network(values['PROXY_DYNAMIC_RANGE'])
    proxy=ipaddress.IPv4Address(values['PROXY_IP']);web=ipaddress.IPv4Address(values['WEB_IP']);gateway=ipaddress.IPv4Address(values['PROXY_GATEWAY'])
    if not dynamic.subnet_of(subnet) or any(ip not in subnet or ip in dynamic or ip in (subnet.network_address,subnet.broadcast_address) for ip in (proxy,web,gateway)) or len({proxy,web,gateway})!=3:
        raise ValueError('Proxy, web and gateway must be distinct usable addresses outside the dynamic pool within the subnet')

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--env',type=pathlib.Path,required=True)
    p.add_argument('--project',required=True)
    p.add_argument('--compose-override',type=pathlib.Path,action='append',default=[])
    p.add_argument('action',choices=['init','backup','restore','validate'])
    p.add_argument('--backup',type=pathlib.Path)
    a=p.parse_args(); values,root=config(a.env)
    if int(values.get('APP_UID','1000'))!=os.getuid() or int(values.get('APP_GID','1000'))!=os.getgid(): raise ValueError('Run as the configured APP_UID/APP_GID so private files remain readable')
    if not re.fullmatch('[a-z0-9][a-z0-9_-]+',a.project): raise ValueError('Invalid project')
    # Clear inherited Compose overrides: the selected env file is the source of truth.
    env=os.environ.copy()
    for key in values: env.pop(key,None)
    dc=['docker','compose','--project-name',a.project,'--env-file',str(a.env.resolve()),'-f',str(HERE/'compose.yaml')]
    for override in a.compose_override:
        if override.name=='compose.proxy.yaml': validate_proxy(values)
        dc += ['-f',str(override.resolve())]
    def compose(*args,**kw): return run(dc+list(args),env=env,**kw)
    if a.action=='validate':
        compose('config','--quiet');print('Runtime configuration validated.');return
    if a.action=='init':
        if root.exists(): raise ValueError('DATA_ROOT already exists; initialization never overwrites data')
        root.mkdir(parents=True,mode=0o700)
        for name in ['postgres','media','secrets','tls']: (root/name).mkdir(mode=0o700)
        for name in ['postgres_password','app_db_password','auth_secret']: (root/'secrets'/name).write_text(secrets.token_hex(32)+'\n')
        run(['openssl','req','-x509','-newkey','rsa:3072','-nodes','-days','30','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',str(root/'tls/server.key'),'-out',str(root/'tls/server.crt')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        print('Created private data directories and local-only TLS certificate. No application started.')
        return
    if not a.backup: raise ValueError('--backup is required')
    backup=a.backup.resolve()
    with (root/'.operation.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if a.action=='backup':
            if backup.exists() or root==backup or root in backup.parents: raise ValueError('Backup must be new and outside DATA_ROOT')
            running=compose('ps','--status','running','--services',capture_output=True,text=True).stdout.split()
            if 'migrate' in running: raise ValueError('Stop migration/maintenance writers first')
            # Caller must also suspend external SQL/CLI writers for this project.
            stage=backup.with_name(backup.name+'.partial')
            stage.mkdir(parents=True,mode=0o700)
            try:
                compose('stop','--timeout','30','api')
                with (stage/'database.dump').open('wb') as f:
                    compose('exec','-T','postgres','pg_dump','-U','postgres','-d','hd_auto','--format=custom','--no-owner','--no-acl',stdout=f)
                media={}
                with tarfile.open(stage/'media.tar','w') as tar:
                    for item in sorted((root/'media').iterdir()):
                        if not re.fullmatch(r'[0-9a-f-]{36}(?:\.thumb)?\.webp',item.name) or item.is_symlink() or not item.is_file() or item.stat().st_nlink!=1: raise ValueError('Unexpected media entry; reconcile before backup')
                        media[item.name]=digest(item); tar.add(item,arcname=item.name,recursive=False)
                manifest={'format':1,'createdAt':datetime.now(timezone.utc).isoformat(),'release':values['RELEASE_ID'],'platform':values.get('TARGET_PLATFORM'),'media':media,'databaseSha256':digest(stage/'database.dump'),'mediaTarSha256':digest(stage/'media.tar')}
                (stage/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
                stage.rename(backup)
                print(f'Consistent backup completed: {len(media)} media files. This is a local copy, not offsite disaster recovery.')
            finally:
                if 'api' in running: compose('start','api')
        else:
            manifest=json.loads((backup/'manifest.json').read_text())
            if manifest['format']!=1 or digest(backup/'database.dump')!=manifest['databaseSha256'] or digest(backup/'media.tar')!=manifest['mediaTarSha256']: raise ValueError('Backup checksum mismatch')
            if any((root/'media').iterdir()) or any((root/'postgres').iterdir()): raise ValueError('Restore only into freshly initialized empty data directories')
            running=compose('ps','--status','running','--services',capture_output=True,text=True).stdout.split()
            if running: raise ValueError('Restore project must have no running services')
            # Validate the complete archive before mutating the destination.
            with tarfile.open(backup/'media.tar') as tar, tempfile.TemporaryDirectory(dir=root) as tmp:
                names=set()
                for member in tar.getmembers():
                    if not member.isfile() or not re.fullmatch(r'[0-9a-f-]{36}(?:\.thumb)?\.webp',member.name) or member.name in names: raise ValueError('Invalid media archive')
                    names.add(member.name)
                    target=pathlib.Path(tmp)/member.name
                    with tar.extractfile(member) as src, target.open('wb') as dst: shutil.copyfileobj(src,dst)
                    if digest(target)!=manifest['media'].get(member.name): raise ValueError('Media checksum mismatch')
                if names!=set(manifest['media']): raise ValueError('Media manifest mismatch')
                compose('up','-d','--wait','postgres')
                with (backup/'database.dump').open('rb') as f:
                    compose('exec','-T','postgres','pg_restore','-U','postgres','-d','hd_auto','--role=hd_app','--no-owner','--no-acl','--exit-on-error','--single-transaction',stdin=f)
                for file in pathlib.Path(tmp).iterdir(): shutil.copyfile(file,root/'media'/file.name)
            print('Restored database and verified media. Run migrations once, then start API/web/proxy and verify before cutover.')

if __name__=='__main__':
    try: main()
    except (ValueError,KeyError,OSError,subprocess.CalledProcessError) as e:
        print(f'Operation failed ({type(e).__name__}); keep partial data for diagnosis. No secrets printed.',file=sys.stderr);sys.exit(1)
