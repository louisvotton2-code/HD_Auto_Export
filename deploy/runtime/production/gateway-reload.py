"""Validate and gracefully reload the existing public proxy, retaining rollback.

Only reviewed root-owned bundles in /srv/hd-auto/staging/gateway are accepted.
The host bundle remains the source for a later explicit proxy rebuild. This first
bootstrap does not recreate the container holding public ports 80/443.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import time

ROOT=Path('/srv/hd-auto/staging/gateway')
PROXY='hd-auto-proxy-1'


def regular_tree(root):
    if root.resolve()!=root or not root.is_dir():raise ValueError('Canonical bundle required')
    for p in [root,*root.rglob('*')]:
        st=p.lstat()
        if st.st_uid!=0 or st.st_mode & 0o022 or not (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode)):
            raise ValueError('Root-owned immutable regular bundle required')


def copy_config(source, destination):
    destination.mkdir(parents=True, exist_ok=True)
    wanted={p.relative_to(source) for p in source.rglob('*') if p.is_file()}
    existing={p.relative_to(destination) for p in destination.rglob('*') if p.is_file()}
    # Fixed, reviewed file set; never leave an unexpected config active.
    if existing and existing != wanted:
        raise ValueError('Config file-set changes require explicit migration')
    for relative in wanted:
        target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True)
        temp=target.with_name(target.name+'.pending')
        if temp.exists():raise ValueError('Unfinished config replacement')
        shutil.copyfile(source/relative,temp);temp.chmod(0o644);os.replace(temp,target)


def apply(bundle):
    if os.getuid()!=0 or not bundle.is_relative_to(ROOT/'bundles'):
        raise ValueError('Use reviewed gateway bundle root')
    regular_tree(bundle)
    for name in ('conf.d','hd-domains'):
        if not (bundle/name).is_dir():raise ValueError('Missing configuration section')
    with (ROOT/'reload.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        stamp=str(time.time_ns());saved=ROOT/'rollback'/stamp;saved.mkdir(parents=True,mode=0o700)
        def call(args):subprocess.run(args,check=True,timeout=30,stdout=subprocess.DEVNULL)
        for name,target in [('conf.d','/etc/nginx/conf.d'),('hd-domains','/etc/nginx/hd-domains')]:
            call(['docker','cp',PROXY+':'+target,str(saved/name)])
        inspected=json.loads(subprocess.check_output(['docker','inspect',PROXY]))[0]
        previous=inspected['State']['StartedAt']
        mounted=any(m['Destination']=='/etc/nginx/conf.d' and m['Source']==str(ROOT/'conf.d') for m in inspected['Mounts'])
        def install(from_root):
            for name,target in [('conf.d','/etc/nginx/conf.d'),('hd-domains','/etc/nginx/hd-domains')]:
                if mounted:copy_config(from_root/name,ROOT/name)
                else:call(['docker','cp',str(from_root/name)+'/.',PROXY+':'+target])
        try:
            install(bundle)
            call(['docker','exec',PROXY,'nginx','-t'])
            call(['docker','exec',PROXY,'nginx','-s','reload'])
        except BaseException:
            install(saved)
            call(['docker','exec',PROXY,'nginx','-t'])
            call(['docker','exec',PROXY,'nginx','-s','reload'])
            raise
        # Copy the accepted config for reproducible future container creation.
        # No symlink outside the reviewed state and no unreviewed config removal.
        for name in ('conf.d','hd-domains'):
            if not mounted:copy_config(bundle/name,ROOT/name)
        after=json.loads(subprocess.check_output(['docker','inspect',PROXY]))[0]['State']['StartedAt']
        if previous!=after:raise ValueError('Proxy unexpectedly restarted')
        result={'bundle':str(bundle),'rollback':str(saved),'proxyStartedAt':after,'reloaded':True}
        (ROOT/'current.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('bundle',type=Path);apply(p.parse_args().bundle)
