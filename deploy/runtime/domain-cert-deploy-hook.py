#!/usr/bin/env python3
"""Certbot deploy hook. Root-only settings live outside source control."""
import json, os, pathlib, subprocess, sys
HERE=pathlib.Path(__file__).resolve().parent
SETTINGS=pathlib.Path('/etc/hd-auto/cert-renew.json')
def main():
 st=SETTINGS.lstat()
 if not SETTINGS.is_file() or SETTINGS.is_symlink() or st.st_uid!=0 or st.st_mode&0o077:raise ValueError('Certificate hook settings must be root-owned and private')
 cfg=json.loads(SETTINGS.read_text());env=pathlib.Path(cfg['runtime_env']);lineage=pathlib.Path(cfg['lineage']);project=cfg['project']
 if not env.is_absolute() or not lineage.is_absolute() or str(lineage)!=os.environ.get('RENEWED_LINEAGE'):raise ValueError('Unexpected certificate lineage or runtime environment')
 subprocess.run([sys.executable,str(HERE/'install-domain-certificate.py'),'--env',str(env),'--project',project,'--cert',str(lineage/'fullchain.pem'),'--key',str(lineage/'privkey.pem')],check=True)
if __name__=='__main__':
 try:main()
 except (ValueError,KeyError,OSError,subprocess.CalledProcessError):
  print('Certificate deploy hook failed; verify the proxy and previous certificate.',file=sys.stderr);sys.exit(1)
