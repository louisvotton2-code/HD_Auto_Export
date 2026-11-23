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


LEGACY_WEBSITE_ORIGIN = 'https://cars.hongdingauto.com'
APEX_WEBSITE_ORIGIN = 'https://hongdingauto.com'
APEX_ALIASES = '''
server {
    include /etc/nginx/hd-domains/edge-server.conf;
    listen 8080;
    server_name www.hongdingauto.com;
    location ^~ /.well-known/acme-challenge/ { root /srv/acme; try_files $uri =404; }
    location / { return 308 https://hongdingauto.com$request_uri; }
}
server {
    include /etc/nginx/hd-domains/edge-server.conf;
    listen 8443 ssl;
    server_name www.hongdingauto.com;
    if ($ssl_server_name !~* "^www[.]hongdingauto[.]com$") { return 421; }
    if ($host != www.hongdingauto.com) { return 421; }
    ssl_certificate /run/tls/apex/current/server.crt;
    ssl_certificate_key /run/tls/apex/current/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    http2 on;
    server_tokens off;
    location / { return 308 https://hongdingauto.com$request_uri; }
}
'''


def slot_config(config, *, slot, release, api_ip, web_ip, mode_root,
                html_cache_ip=None, html_cache_secret_file=None, html_cache_protocol='2'):
    if slot not in ('blue', 'green') or not re.fullmatch(r'[a-f0-9]{40}', release):
        raise ValueError('Explicit slot and immutable release required')
    for address in (api_ip, web_ip):
        if not ipaddress.ip_address(address).is_private:
            raise ValueError('Private application addresses required')
    if api_ip == web_ip:
        raise ValueError('Distinct slot addresses required')
    if bool(html_cache_ip) != bool(html_cache_secret_file):
        raise ValueError('HTML cache requires both a fixed address and a private secret file')
    if html_cache_protocol not in ('2', '3') or (html_cache_protocol == '3' and not html_cache_ip):
        raise ValueError('The homepage cache protocol must match the configured sidecar')
    root = Path(mode_root)
    if not root.is_absolute() or '..' in root.parts:
        raise ValueError('Absolute persistent serving-mode directory required')
    site_origin = config['services']['web'].get('environment', {}).get('NEXT_PUBLIC_SITE_URL')
    if (site_origin == APEX_WEBSITE_ORIGIN
            and config['services']['api'].get('environment', {}).get('ANALYTICS_ORIGINS') != site_origin):
        raise ValueError('Apex API analytics must use the canonical website origin')
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
        if site_origin not in (LEGACY_WEBSITE_ORIGIN, APEX_WEBSITE_ORIGIN):
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
                'HD_HTML_CACHE_SITE_HOST': site_origin.removeprefix('https://'),
                'HD_HTML_CACHE_PROTOCOL': html_cache_protocol,
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
                  html_cache_host=None, page_documents=False, page_visits=False,
                  website_origin=LEGACY_WEBSITE_ORIGIN):
    if website_origin not in (LEGACY_WEBSITE_ORIGIN, APEX_WEBSITE_ORIGIN):
        raise ValueError('Only an exact supported HTTPS website origin is accepted')
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
            if website_origin == APEX_WEBSITE_ORIGIN:
                public = (public.replace('cars.hongdingauto.com', 'hongdingauto.com')
                          .replace('^cars[.]hongdingauto[.]com$', '^hongdingauto[.]com$')
                          .replace('/run/tls/current/', '/run/tls/apex/current/'))
                admin = admin.replace('/run/tls/current/', '/run/tls/admin/current/')
                # Inline only the apex HTTPS server's existing edge policy, changing
                # its idle timeout without altering the shared include or rollback files.
                marker = ('server {\n    include /etc/nginx/hd-domains/edge-server.conf;\n'
                          '    listen 8443 ssl;\n    server_name hongdingauto.com;')
                if public.count(marker) != 1:
                    raise ValueError('Expected exactly one apex TLS server')
                edge = files['hd-domains/edge-server.conf']
                if edge.count('keepalive_timeout 15s;') != 1:
                    raise ValueError('Unexpected shared edge keepalive policy')
                inline = ''.join('    '+line if line.strip() else line for line in edge.replace(
                    'keepalive_timeout 15s;', 'keepalive_timeout 60s;').splitlines(keepends=True))
                replacement = ('server {\n' + inline + '    listen 8443 ssl;\n'
                               '    server_name hongdingauto.com;')
                public = public.replace(marker, replacement, 1)

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
    if page_documents:
        text = text.replace('set $hd_page_documents_enabled 0;', 'set $hd_page_documents_enabled 1;')
    if page_visits:
        text = text.replace('set $hd_page_visits_enabled 0;', 'set $hd_page_visits_enabled 1;')
    # Replace the upstream only, retaining MIME, compression and response policies from the template.
    text=re.sub(r'(    location \^~ /_next/static/ \{\n)(?:        [^\n]*\n)*?(?=        gzip_types )',
                r'\1        root /srv/hd-assets;\n        try_files $uri =404;\n',text)
    if html_cache_host:
        text = text.replace('    # HD_HTML_CACHE_LOCATIONS', f'''    location ~ "^/(zh|en|ru)/$" {{
        error_page 419 502 504 = @hd_home_dynamic;
        if ($request_method != GET) {{ return 419; }}
        resolver 127.0.0.11 valid=10s ipv6=off;
        set $web http://{html_cache_host}:3010;
        include /etc/nginx/hd-domains/web-proxy.conf;
        gzip on;
        proxy_intercept_errors on;
        proxy_hide_header Cache-Control;
        add_header Strict-Transport-Security $hd_hsts always;
        add_header Cache-Control 'no-store' always;
    }}
    location @hd_home_dynamic {{
        resolver 127.0.0.11 valid=10s ipv6=off;
        set $web http://{web_host}:3000;
        include /etc/nginx/hd-domains/web-proxy.conf;
        gzip on;
        proxy_hide_header Cache-Control;
        add_header Strict-Transport-Security $hd_hsts always;
        add_header Cache-Control 'no-store' always;
    }}''')
    files['default.conf'] = text + APEX_ALIASES if website_origin == APEX_WEBSITE_ORIGIN else text
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
    parser.add_argument('--html-cache-protocol',choices=('2','3'),default='2')
    args=parser.parse_args()
    result=slot_config(json.loads(args.compose_json.read_text()),slot=args.slot,release=args.release,
        api_ip=args.api_ip,web_ip=args.web_ip,mode_root=args.mode_root,
        html_cache_ip=args.html_cache_ip,html_cache_secret_file=args.html_cache_secret_file,
        html_cache_protocol=args.html_cache_protocol)
    with args.output.open('x') as out:json.dump(result,out,indent=2)
    args.output.chmod(0o600)


if __name__=='__main__':main()
