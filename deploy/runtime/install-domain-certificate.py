#!/usr/bin/env python3
"""Install a two-domain certificate as an atomic version; never print private key data."""
import argparse, fcntl, os, pathlib, secrets, shutil, subprocess, sys
from runtime import config, validate_proxy, validate_domains
HERE=pathlib.Path(__file__).resolve().parent
HOSTS=('cars.hongdingauto.com','admin.hongdingauto.com')
def command(args,**kw): return subprocess.run(args,check=True,**kw)
def output(args): return subprocess.check_output(args,stderr=subprocess.DEVNULL)
def main():
 p=argparse.ArgumentParser();p.add_argument('--env',type=pathlib.Path,required=True);p.add_argument('--project',required=True)
 p.add_argument('--cert',type=pathlib.Path,required=True);p.add_argument('--key',type=pathlib.Path,required=True)
 p.add_argument('--bootstrap',action='store_true');a=p.parse_args()
 if not __import__('re').fullmatch('[a-z0-9][a-z0-9_-]+',a.project): raise ValueError('Invalid project')
 values,root=config(a.env);validate_proxy(values);validate_domains(values);tls=root/'tls'
 if not tls.is_dir() or tls.is_symlink():raise ValueError('Private TLS directory is required')
 env=os.environ.copy()
 for key in values:env.pop(key,None)
 dc=['docker','compose','--project-name',a.project,'--env-file',str(a.env.resolve()),'-f',str(HERE/'compose.yaml'),'-f',str(HERE/'compose.proxy.yaml'),'-f',str(HERE/'compose.media.yaml'),'-f',str(HERE/'compose.domains.yaml')]
 def compose(*args,**kw):return command(dc+list(args),env=env,**kw)
 for host in HOSTS:command(['openssl','x509','-in',str(a.cert),'-noout','-checkhost',host],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 command(['openssl','x509','-in',str(a.cert),'-noout','-checkend','86400'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 cert_pub=output(['openssl','x509','-in',str(a.cert),'-pubkey','-noout'])
 key_pub=output(['openssl','pkey','-in',str(a.key),'-pubout'])
 if cert_pub!=key_pub:raise ValueError('Certificate and key do not match')
 versions=tls/'versions';versions.mkdir(mode=0o700,exist_ok=True)
 if versions.is_symlink():raise ValueError('TLS versions directory cannot be a symlink')
 with (tls/'.certificate.lock').open('w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  current=tls/'current';old=os.readlink(current) if current.is_symlink() else None
  if current.exists() and not current.is_symlink():raise ValueError('TLS current must be a symlink')
  if old is not None and (not old.startswith('versions/') or '/' in old[len('versions/'):]):raise ValueError('Invalid existing TLS version')
  running=compose('ps','--status','running','--services',capture_output=True,text=True).stdout.split()
  if a.bootstrap and (old is not None or 'proxy' in running):raise ValueError('Bootstrap requires no existing certificate or running proxy')
  if not a.bootstrap and (old is None or 'proxy' not in running):raise ValueError('Renewal requires an existing certificate and running proxy')
  version=secrets.token_hex(16);target=versions/version;target.mkdir(mode=0o700)
  for src,name in [(a.cert,'server.crt'),(a.key,'server.key')]:
   with src.open('rb') as inp, (target/name).open('xb') as dst:shutil.copyfileobj(inp,dst)
   os.chmod(target/name,0o600)
  link=tls/('.current-'+version);link.symlink_to('versions/'+version);os.replace(link,current)
  try:
   if not a.bootstrap:
    compose('exec','-T','proxy','nginx','-c','/etc/nginx/nginx-media-main.conf','-t')
    compose('exec','-T','proxy','nginx','-c','/etc/nginx/nginx-media-main.conf','-s','reload')
  except BaseException:
   if old is not None:
    rollback=tls/('.rollback-'+version);rollback.symlink_to(old);os.replace(rollback,current)
    try:compose('exec','-T','proxy','nginx','-c','/etc/nginx/nginx-media-main.conf','-s','reload')
    except Exception:print('Rollback reload failed; inspect proxy immediately.',file=sys.stderr)
   else:current.unlink(missing_ok=True)
   raise
  print('Certificate installed' + (' for bootstrap.' if a.bootstrap else ' and proxy reloaded.'))
if __name__=='__main__':
 os.umask(0o077)
 try:main()
 except (ValueError,KeyError,OSError,subprocess.CalledProcessError) as e:
  print(f'Certificate installation failed ({type(e).__name__}); previous version retained when possible.',file=sys.stderr);sys.exit(1)
