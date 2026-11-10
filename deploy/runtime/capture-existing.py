#!/usr/bin/env python3
"""Capture the pre-Compose local API only in a PM-coordinated stopped-write window.
Does not stop/restart any service. Output is compatible with runtime.py restore.
"""
import argparse, errno, hashlib, json, os, pathlib, re, socket, subprocess, sys, tarfile
from datetime import datetime, timezone
from urllib.parse import urlparse, unquote
os.umask(0o077)
def digest(file):
    h=hashlib.sha256()
    with file.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()
def ensure_api_stopped(port):
    with socket.socket() as sock:
        sock.settimeout(3);code=sock.connect_ex(('127.0.0.1',port))
    if code==0: raise ValueError('Source API is still listening; ask PM/BE to coordinate the write pause first')
    if code!=errno.ECONNREFUSED: raise ValueError('Cannot verify source API is stopped; permission/network errors are not proof')
def main():
    p=argparse.ArgumentParser();p.add_argument('--source-env',type=pathlib.Path,required=True)
    p.add_argument('--database-container',required=True);p.add_argument('--release-id',required=True);p.add_argument('--backup',type=pathlib.Path,required=True);a=p.parse_args()
    env={}
    for line in a.source_env.read_text().splitlines():
        if line and not line.startswith('#') and '=' in line:k,v=line.split('=',1);env[k]=v
    if env.get('HOST','127.0.0.1')!='127.0.0.1': raise ValueError('Only the local legacy acceptance API is supported')
    db=urlparse(env['DATABASE_URL']);user=unquote(db.username or '');name=unquote(db.path.lstrip('/'))
    if db.hostname not in ('127.0.0.1','localhost') or not all(re.fullmatch(r'[a-zA-Z0-9_]+',v) for v in [user,name]): raise ValueError('Unexpected source database identity')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]+',a.database_container): raise ValueError('Invalid database container')
    media=pathlib.Path(env['MEDIA_ROOT'])
    if not media.is_absolute() or media.is_symlink() or not media.is_dir() or media.stat().st_mode&0o077: raise ValueError('Source media must be an absolute private directory')
    ensure_api_stopped(int(env.get('PORT','3320')))
    target=a.backup.resolve();stage=target.with_name(target.name+'.partial')
    if target.exists() or media==target or media in target.parents: raise ValueError('Backup must be new and outside media')
    stage.mkdir(parents=True,mode=0o700)
    with (stage/'database.dump').open('wb') as f:
        subprocess.run(['docker','exec',a.database_container,'pg_dump','-U',user,'-d',name,'--format=custom','--no-owner','--no-acl'],stdout=f,check=True)
    hashes={}
    with tarfile.open(stage/'media.tar','w') as tar:
        for file in sorted(media.iterdir()):
            if not re.fullmatch(r'[0-9a-f-]{36}(?:\.thumb)?\.webp',file.name) or file.is_symlink() or not file.is_file() or file.stat().st_mode&0o077 or file.stat().st_nlink!=1: raise ValueError('Unexpected or non-private media entry; reconcile before capture')
            hashes[file.name]=digest(file);tar.add(file,arcname=file.name,recursive=False)
    ensure_api_stopped(int(env.get('PORT','3320')))
    manifest={'format':1,'createdAt':datetime.now(timezone.utc).isoformat(),'release':a.release_id,'platform':'source-local','media':hashes,'databaseSha256':digest(stage/'database.dump'),'mediaTarSha256':digest(stage/'media.tar')}
    (stage/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');stage.rename(target)
    print(f'Existing local database + {len(hashes)} media files captured. PM/BE can resume the source API; restored target is validation-only.')
if __name__=='__main__':
    try:main()
    except ValueError as e:print(str(e),file=sys.stderr);sys.exit(1)
    except (OSError,KeyError,subprocess.CalledProcessError) as e:print(f'Capture failed ({type(e).__name__}); preserve partial files, coordinate source resume with PM/BE.',file=sys.stderr);sys.exit(1)
