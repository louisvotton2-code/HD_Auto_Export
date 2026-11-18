"""Render private application slots and a persistent, reloadable gateway bundle.

No database replacement or backup is part of a normal release. The caller must
supply an already reviewed/built release and explicitly perform writer handoff.
"""
import argparse
import copy
import ipaddress
import json
from pathlib import Path
import re


def slot_config(config, *, slot, release, api_ip, web_ip, mode_root,
                html_cache_ip=None, html_cache_secret_file=None):
    if slot not in ('blue', 'green') or not re.fullmatch(r'[a-f0-9]{40}', release):
        raise ValueError('Explicit slot and immutable release required')
    for address in (api_ip, web_ip):
        if not ipaddress.ip_address(address).is_private:
            raise ValueError('Private application addresses required')
    if api_ip == web_ip:
        raise ValueError('Distinct slot addresses required')
    if bool(html_cache_ip) != bool(html_cache_secret_file):
        raise ValueError('HTML cache requires both a fixed address and a private secret file')
    root = Path(mode_root)
    if not root.is_absolute() or '..' in root.parts:
        raise ValueError('Absolute persistent serving-mode directory required')
    result = {'services': {}, 'networks': {}, 'secrets': copy.deepcopy(config.get('secrets', {}))}
    for name in ('api', 'web'):
        svc = copy.deepcopy(config['services'][name])
        for key in ('build', 'depends_on', 'container_name', 'ports', 'profiles'):
            svc.pop(key, None)
        svc['image'] = f'hd-auto-{name}:{release}'
        svc['networks'] = copy.deepcopy(svc.get('networks', {'default': {}}))
        svc['networks']['default'] = {'ipv4_address': api_ip if name == 'api' else web_ip,
                                     'aliases': [f'{name}-{slot}']}
        env = svc.setdefault('environment', {})
        env['HD_RELEASE_ID'] = release
        if name == 'api':
            env['API_SERVING_MODE_FILE'] = '/run/hd-serving/mode'
            env['HD_SSR_SERVICE_PEERS'] = web_ip+'/32'
            old_web_ip = config['services']['web']['networks']['default']['ipv4_address']
            env['TRUST_PROXY'] = env['TRUST_PROXY'].replace(old_web_ip+'/32', web_ip+'/32')
            svc.setdefault('volumes', []).append({'type': 'bind', 'source': str(root),
                'target': '/run/hd-serving', 'read_only': True, 'bind': {'create_host_path': False}})
        else:
            env['VEHICLE_API_BASE_URL'] = f'http://api-{slot}:3320'
        result['services'][f'{name}-{slot}'] = svc
        for network in svc['networks']:
            actual = config['networks'][network]
            if network == 'default' and actual.get('internal') is not True:
                raise ValueError('Application data network must be private')
            result['networks'][network] = {'external': True, 'name': actual['name']}
    if html_cache_ip:
        edge_ip = config['services']['proxy']['networks']['default']['ipv4_address']
        addresses = [ipaddress.IPv4Address(value) for value in (edge_ip, api_ip, web_ip, html_cache_ip)]
        if len(set(addresses)) != 4 or not all(address.is_private for address in addresses):
            raise ValueError('HTML cache requires distinct fixed private IPv4 peers')
        secret = Path(html_cache_secret_file)
        if not secret.is_absolute() or '..' in secret.parts or 'html_cache_secret' in result['secrets']:
            raise ValueError('Use a separate private HTML cache secret')
        site_origin = config['services']['web']['environment']['NEXT_PUBLIC_SITE_URL']
        if site_origin != 'https://cars.hongdingauto.com':
            raise ValueError('HTML cache is scoped to the public website')
        result['secrets']['html_cache_secret'] = {'file': str(secret)}
        web = result['services'][f'web-{slot}']
        web.setdefault('secrets', []).append('html_cache_secret')
        web['environment']['HD_HTML_CACHE_SECRET_FILE'] = '/run/secrets/html_cache_secret'
        name = f'html-cache-{slot}'
        result['services'][name] = {
            'image': f'hd-auto-html-cache:{release}',
            'user': web['user'], 'platform': web['platform'], 'init': True,
            'read_only': True, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
            'restart': 'on-failure:5', 'cpus': 0.25, 'mem_limit': '96m',
            'environment': {
                'HD_HTML_CACHE_ORIGIN': f'http://web-{slot}:3000',
                'HD_HTML_CACHE_SITE_HOST': 'cars.hongdingauto.com',
                'HD_HTML_CACHE_EDGE_IP': edge_ip,
                'HD_HTML_CACHE_SECRET_FILE': '/run/secrets/html_cache_secret',
                'HD_RELEASE_ID': release,
                'NODE_OPTIONS': '--max-old-space-size=48',
            },
            'secrets': ['html_cache_secret'],
            'networks': {'default': {'ipv4_address': html_cache_ip, 'aliases': [name]}},
            'logging': web['logging'],
        }
    return result


def gateway_files(source, *, web_host, public_api_host, admin_api_host, freeze_admin=False,
                  html_cache_host=None):
    for value in (web_host, public_api_host, admin_api_host):
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,62}', value):
            raise ValueError('Only explicit Docker service aliases accepted')
    if html_cache_host is not None and (not re.fullmatch(r'html-cache-(?:blue|green)', html_cache_host)
                                      or web_host != html_cache_host.replace('html-cache', 'web')):
        raise ValueError('HTML cache must belong to the same explicit Web slot')
    source = Path(source)
    files = {'default.conf': (source/'nginx-domains.conf').read_text()}
    for path in (source/'nginx-domains').glob('*.conf'):
        files['hd-domains/'+path.name] = path.read_text()
    # The same public authorization/media rules remain; replace only upstreams.
    for name, text in list(files.items()):
        if name == 'default.conf':
            marker='    server_name admin.hongdingauto.com;'
            # HTTP admin redirect block and TLS admin block both match; only TLS
            # block contains api routing, so split at the last occurrence.
            boundary=text.rindex(marker)
            public, admin=text[:boundary], text[boundary:]
            public=public.replace('http://api:3320', f'http://{public_api_host}:3320')
            admin=admin.replace('http://api:3320', f'http://{admin_api_host}:3320')
            if freeze_admin:
                # Block all admin API traffic, including auth GET side effects.
                admin=admin.replace('    location /api/ {', '    location /api/ {\n        return 503;')
            text=public+admin
        else:
            text=text.replace('http://api:3320', f'http://{public_api_host}:3320')
        text=text.replace('http://web:3000', f'http://{web_host}:3000')
        files[name]=text
    # Immutable static files from current + previous releases coexist. A query
    # parameter never selects a release or enables a buffered HTML response.
    text=files['default.conf']
    block='''    location ^~ /_next/static/ {
        root /srv/hd-assets;
        try_files $uri =404;
        add_header Cache-Control $hd_asset_cache_control always;
    }'''
    text=re.sub(r'    location \^~ /_next/static/ \{\n.*?\n    \}',lambda _:block,text,flags=re.S)
    if html_cache_host:
        text = text.replace('    # HD_HTML_CACHE_LOCATIONS', f'''    location ~ "^/(zh|en|ru)/$" {{
        error_page 419 502 504 = @hd_home_dynamic;
        if ($request_method != GET) {{ return 419; }}
        resolver 127.0.0.11 valid=10s ipv6=off;
        set $web http://{html_cache_host}:3010;
        include /etc/nginx/hd-domains/web-proxy.conf;
        proxy_intercept_errors on;
        proxy_hide_header Cache-Control;
        add_header Cache-Control 'no-store' always;
    }}
    location @hd_home_dynamic {{
        resolver 127.0.0.11 valid=10s ipv6=off;
        set $web http://{web_host}:3000;
        include /etc/nginx/hd-domains/web-proxy.conf;
        proxy_hide_header Cache-Control;
        add_header Cache-Control 'no-store' always;
    }}''')
    files['default.conf']=text
    return files


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compose-json',type=Path,required=True)
    parser.add_argument('--slot',choices=['blue','green'],required=True)
    parser.add_argument('--release',required=True)
    parser.add_argument('--api-ip',required=True);parser.add_argument('--web-ip',required=True)
    parser.add_argument('--mode-root',required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--html-cache-ip')
    parser.add_argument('--html-cache-secret-file',type=Path)
    args=parser.parse_args()
    result=slot_config(json.loads(args.compose_json.read_text()),slot=args.slot,release=args.release,
        api_ip=args.api_ip,web_ip=args.web_ip,mode_root=args.mode_root,
        html_cache_ip=args.html_cache_ip,html_cache_secret_file=args.html_cache_secret_file)
    with args.output.open('x') as out:json.dump(result,out,indent=2)
    args.output.chmod(0o600)


if __name__=='__main__':main()
