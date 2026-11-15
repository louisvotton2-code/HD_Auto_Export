"""Validate and gracefully reload the existing public proxy, retaining rollback.

Only reviewed root-owned bundles in /srv/hd-auto/staging/gateway are accepted.
The host bundle remains the source for a later explicit proxy rebuild. This first
bootstrap does not recreate the container holding public ports 80/443.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import shlex
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


def preflight_config(source, destination):
    wanted = {p.relative_to(source) for p in source.rglob('*') if p.is_file()}
    existing = {p.relative_to(destination) for p in destination.rglob('*') if p.is_file()}
    if any(p.name.endswith('.pending') for p in destination.rglob('*')):
        raise ValueError('Unfinished config replacement')
    # Do not leave unexpected includes active after a directory copy.
    if existing and existing != wanted:
        raise ValueError('Config file-set changes require explicit migration')
    return wanted


def copy_config(source, destination):
    wanted = preflight_config(source, destination)
    destination.mkdir(parents=True, exist_ok=True)
    for relative in wanted:
        target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
        temp=target.with_name(target.name+'.pending')
        shutil.copyfile(source/relative,temp);temp.chmod(0o644);os.replace(temp,target)


def nginx_command(container):
    """Bind validation and reload to the configuration of the running master."""
    command = ['docker', 'exec', container, 'nginx']
    title = subprocess.check_output(
        ['docker', 'exec', container, 'cat', '/proc/1/cmdline'], timeout=10
    ).replace(b'\0', b' ').decode().strip()
    master = 'nginx: master process nginx'
    if title != master and not title.startswith(master + ' '):
        raise ValueError('Expected nginx master as the proxy container entrypoint')
    args = shlex.split(title[len(master):])
    config = None
    daemon_option_seen = False
    while args:
        arg = args.pop(0)
        if arg.startswith('-c') and config is None:
            config = arg[2:] or (args.pop(0) if args else '')
        elif arg == '-g' and not daemon_option_seen:
            # Nginx's process title can flatten the quoted directive into two words.
            if args[:1] == ['daemon off;']:
                del args[:1]
            elif args[:2] == ['daemon', 'off;']:
                del args[:2]
            else:
                raise ValueError('Unsupported nginx master global directives')
            daemon_option_seen = True
        else:
            raise ValueError('Unsupported or ambiguous nginx master options')
    if config is None:
        build = subprocess.check_output(
            command + ['-V'], stderr=subprocess.STDOUT, text=True, timeout=10
        )
        build_configs = [a.removeprefix('--conf-path=') for a in shlex.split(build)
                         if a.startswith('--conf-path=')]
        if len(build_configs) != 1:
            raise ValueError('Cannot determine the default nginx configuration')
        config = build_configs[0]
    path = PurePosixPath(config)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Expected an absolute nginx master configuration path')
    return command + ['-c', config]


def apply(bundle):
    if os.getuid()!=0 or not bundle.is_relative_to(ROOT/'bundles'):
        raise ValueError('Use reviewed gateway bundle root')
    regular_tree(bundle)
    for name in ('conf.d','hd-domains'):
        if not (bundle/name).is_dir():raise ValueError('Missing configuration section')
    with (ROOT/'reload.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        nginx = nginx_command(PROXY)
        stamp=str(time.time_ns());saved=ROOT/'rollback'/stamp;saved.mkdir(parents=True,mode=0o700)
        def call(args):subprocess.run(args,check=True,timeout=30,stdout=subprocess.DEVNULL)
        for name,target in [('conf.d','/etc/nginx/conf.d'),('hd-domains','/etc/nginx/hd-domains')]:
            call(['docker','cp',PROXY+':'+target,str(saved/name)])
        inspected=json.loads(subprocess.check_output(['docker','inspect',PROXY]))[0]
        previous=inspected['State']['StartedAt']
        for name in ('conf.d','hd-domains'):
            preflight_config(bundle/name,saved/name)
            preflight_config(bundle/name,ROOT/name)
        mounted=any(m['Destination']=='/etc/nginx/conf.d' and m['Source']==str(ROOT/'conf.d') for m in inspected['Mounts'])
        def install(from_root):
            for name,target in [('conf.d','/etc/nginx/conf.d'),('hd-domains','/etc/nginx/hd-domains')]:
                if mounted:copy_config(from_root/name,ROOT/name)
                else:call(['docker','cp',str(from_root/name)+'/.',PROXY+':'+target])
        try:
            install(bundle)
            call(nginx + ['-t'])
            call(nginx + ['-s', 'reload'])
        except BaseException:
            install(saved)
            call(nginx + ['-t'])
            call(nginx + ['-s', 'reload'])
            raise
        # Copy the accepted config for reproducible future container creation.
        # No symlink outside the reviewed state and no unreviewed config removal.
        for name in ('conf.d','hd-domains'):
            if not mounted:copy_config(bundle/name,ROOT/name)
        after=json.loads(subprocess.check_output(['docker','inspect',PROXY]))[0]['State']['StartedAt']
        if previous!=after:raise ValueError('Proxy unexpectedly restarted')
        result={'bundle':str(bundle),'rollback':str(saved),'proxyStartedAt':after,'nginxConfig':nginx[-1],'reloaded':True}
        (ROOT/'current.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('bundle',type=Path);apply(p.parse_args().bundle)
