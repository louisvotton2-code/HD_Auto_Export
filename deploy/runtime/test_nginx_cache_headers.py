"""Exercise the actual domain config over private Unix TLS, never a public listener."""
import gzip, http.client, http.server, importlib.util, json, os, pathlib, shutil, socket, socketserver, ssl, subprocess, tempfile, threading, time, unittest
from concurrent.futures import ThreadPoolExecutor
HERE=pathlib.Path(__file__).resolve().parent
NGINX=shutil.which('nginx')
CATALOG_QUERY='locale=zh&view=localized'
CATALOG_JSON=json.dumps({'items': [{'id': i, 'name': 'Example vehicle'} for i in range(24)]}).encode()
ANALYTICS_PATH='/api/v1/analytics/events'
CONTACT_COUNT_PATH='/api/v1/analytics/contact-count'
ANALYTICS_BODY=json.dumps({'events':[{'eventId':'11111111-1111-4111-8111-111111111111',
                                      'type':'page_view','pageType':'home','locale':'zh'}]}).encode()
MEDIA_ID='11111111-1111-4111-8111-111111111111'
MEDIA_PATH='/api/v1/media/'+MEDIA_ID
MEDIA_PREVIEW='/api/v1/admin/media/'+MEDIA_ID+'/preview'
MEDIA_REPRESENTATIONS={'original': ('.webp',b'original WebP fixture'), 'thumb': ('.thumb.webp',b'thumbnail WebP fixture'),
                       'card': ('.card.webp',b'card WebP fixture')}
CACHE_CONTROL_HEADERS=['X-HD-Cache-Protocol', 'X-HD-Catalog-Scope', 'X-HD-HTML-Key', 'X-HD-HTML-Nonce', 'X-HD-HTML-Proof',
                       'X-HD-Render-Target', 'X-HD-Public-HTML-Render-Ticket']
class Origin(http.server.BaseHTTPRequestHandler):
    calls=[]
    media_visible=True
    def media_reply(self, preview):
        variant=self.path.rsplit('?variant=',1)[-1] if '?variant=' in self.path else 'original'
        suffix,image=MEDIA_REPRESENTATIONS[variant]
        validator='"test-'+variant+'"'
        visible=not preview and self.media_visible
        status=200 if visible or preview and self.headers.get('Cookie')=='test-session=yes' else 404
        if visible and self.headers.get('If-None-Match')==validator:
            status=304
        self.send_response(status)
        stream_preview=status==200 and preview and self.headers.get('If-None-Match')=='*'
        if status==200 and not stream_preview:
            internal='/_hd_media/' if preview else '/_hd_public_media/'
            self.send_header('X-Accel-Redirect',internal+MEDIA_ID+suffix)
        else:
            self.send_header('Cache-Control','private, no-cache' if visible else 'no-store')
        if status in (200,304) and visible:
            self.send_header('ETag',validator)
        self.send_header('Content-Length',str(len(image) if stream_preview else 0))
        self.end_headers()
        if stream_preview and self.command!='HEAD':
            self.wfile.write(image)
    def do_GET(self):
        self.calls.append(self.path)
        if self.path.split('?')[0] in (MEDIA_PATH,MEDIA_PREVIEW):
            return self.media_reply(self.path==MEDIA_PREVIEW)
        known={'/_next/static/chunks/chunk-12345678.js':200,'/_next/static/chunks/partial-12345678.js':206,'/_next/static/build-12345678/_buildManifest.js':304}
        status=known.get(self.path,404 if self.path.startswith('/_next/static/') else 200)
        body=json.dumps({'headers':dict(self.headers.items()),'path':self.path}).encode() if not self.path.startswith('/_next/static/') else b'code'
        content_type='application/json'
        if self.path.endswith('?'+CATALOG_QUERY):
            body=CATALOG_JSON
        if '/cars/missing/' in self.path:
            status=404;content_type='text/x-component' if self.headers.get('RSC') else 'text/html';body=b'original missing response'
        elif '/cars/unavailable/' in self.path:status=503;body=b'original unavailable'
        elif '/cars/limited/' in self.path:status=429;body=b'original limited'
        elif self.path.startswith('/404/'):
            content_type='text/html';body=('<html>readable '+self.path.split('/')[2]+' missing vehicle</html>').encode()
        self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Cache-Control','public, max-age=600' if self.path=='/zh/guide/' else 'no-store')
        for name in CACHE_CONTROL_HEADERS:self.send_header(name,'synthetic-origin-control')
        self.send_header('Strict-Transport-Security','max-age=63072000; includeSubDomains; preload')
        if self.path.startswith('/staff/'):
            self.send_header('X-Frame-Options','SAMEORIGIN');self.send_header('Content-Security-Policy',"frame-ancestors 'self'");self.send_header('Referrer-Policy','same-origin')
            self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(body) if status!=304 else 0));self.end_headers()
        if status!=304 and self.command!='HEAD':self.wfile.write(body)
    do_HEAD=do_GET
    def do_POST(self):
        self.calls.append(self.path)
        request_body=self.rfile.read(int(self.headers['Content-Length']))
        body=json.dumps({'headers':dict(self.headers.items()),'data':json.loads(request_body)}).encode()
        self.send_response(200)
        if self.path == CONTACT_COUNT_PATH:
            self.send_header('Set-Cookie', 'synthetic=disallowed')
        self.send_header('Cache-Control','public, max-age=600')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self,*args):pass

class CacheOrigin(Origin):
    calls=[]
    def do_GET(self):
        if self.path=='/ru/':
            self.calls.append(self.path)
            self.send_response(502)
            self.send_header('Content-Length','0')
            self.end_headers()
        else:
            super().do_GET()

class UnixHttp(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):
    daemon_threads=True
    request_queue_size=64  # Synthetic origin must accept the bounded16-client rate probe.
@unittest.skipUnless(NGINX and shutil.which('openssl'),'native nginx and openssl are required for the real header test')
class DomainCacheHeaders(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='hd-rel03-edge-');cls.addClassCleanup(cls.temp.cleanup);cls.root=pathlib.Path(cls.temp.name).resolve();r=cls.root
        for n in ['admin/assets','body','proxy','media']:(r/n).mkdir(parents=True)
        (r/'admin/index.html').write_text('admin');(r/'admin/assets/index-Abc12345.js').write_text('hashed');(r/'admin/assets/plain.js').write_text('plain')
        for suffix,body in MEDIA_REPRESENTATIONS.values():
            (r/'media'/(MEDIA_ID+suffix)).write_bytes(body)
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=cars.hongdingauto.com','-addext','subjectAltName=DNS:cars.hongdingauto.com,DNS:admin.hongdingauto.com','-keyout',str(r/'key.pem'),'-out',str(r/'cert.pem')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        (r/'key.pem').chmod(0o600)
        cls.backend=UnixHttp(str(r/'origin.sock'),Origin);cls.thread=threading.Thread(target=cls.backend.serve_forever,daemon=True);cls.thread.start();cls.addClassCleanup(cls.backend.server_close);cls.addClassCleanup(cls.backend.shutdown)
        cls.cache=UnixHttp(str(r/'cache.sock'),CacheOrigin)
        threading.Thread(target=cls.cache.serve_forever,daemon=True).start()
        cls.addClassCleanup(cls.cache.server_close)
        cls.addClassCleanup(cls.cache.shutdown)
        includes=r/'includes';shutil.copytree(HERE/'nginx-domains',includes)
        for fragment in includes.glob('*.conf'):
            fragment.write_text(fragment.read_text().replace('/etc/nginx/hd-domains',str(includes))
                                .replace('http://api:3320','http://hd_test_origin')
                                .replace('/srv/private-media/',str(r/'media')+'/')
                                .replace('/srv/hd-assets/sitemap',str(r/'sitemap'))
                                .replace('http://web:3000','http://hd_test_origin'))
        spec=importlib.util.spec_from_file_location('slots',HERE/'production/release-slots.py')
        slots=importlib.util.module_from_spec(spec);spec.loader.exec_module(slots)
        marker='    # HD_HTML_CACHE_LOCATIONS'
        args=dict(web_host='web-blue',public_api_host='api-blue',admin_api_host='api-blue')
        inactive=slots.gateway_files(HERE,**args)['default.conf']
        active=slots.gateway_files(HERE,**args,html_cache_host='html-cache-blue')['default.conf']
        before,after=inactive.split(marker)
        assert active.startswith(before) and active.endswith(after)
        route=active[len(before):-len(after)].replace('http://web-blue:3000','http://web:3000')
        config=(HERE/'nginx-domains.conf').read_text().replace(marker,route).replace('/etc/nginx/hd-domains',str(includes)).replace('/run/tls/current/server.crt',str(r/'cert.pem')).replace('/run/tls/current/server.key',str(r/'key.pem')).replace('http://api:3320','http://hd_test_origin').replace('http://web:3000','http://hd_test_origin').replace('http://html-cache-blue:3010','http://hd_test_cache').replace('root /srv;',f'root {r};').replace('listen 8080',f'listen unix:{r}/http.sock').replace('listen 8443',f'listen unix:{r}/tls.sock')
        # Keep the production edge protections; only fixture paths and transport differ.
        edge=(HERE/'nginx-edge.conf').read_text().replace('/etc/nginx/hd-analytics-geo/country.conf',
                                                         str(HERE/'production/analytics-geo-disabled.conf'))
        # Darwin's larger pages require a larger bookkeeping zone; rate/burst/connection limits are identical.
        if os.uname().sysname=='Darwin':edge=edge.replace('zone=hd_edge_total:64k','zone=hd_edge_total:256k')
        rootuser='user root;\n' if os.getuid()==0 else ''
        single=(HERE/'nginx.conf').read_text().replace('/etc/nginx/hd-domains',str(includes))
        single=single.replace('/run/tls/server.crt',str(r/'cert.pem')).replace('/run/tls/server.key',str(r/'key.pem'))
        single=single.replace('listen 8443 ssl',f'listen unix:{r}/single.sock ssl')
        single_config=r/'single.conf'
        single_config.write_text(rootuser+f'pid {r}/single.pid; events {{}} http {{ client_body_temp_path {r}/body; proxy_temp_path {r}/proxy;\n'+edge+'\n'+single+'\n}')
        subprocess.run([NGINX,'-t','-e',str(r/'single.log'),'-p',str(r)+'/', '-c',str(single_config)],
                       check=True,capture_output=True,text=True)
        full=rootuser+f'worker_processes 1;\npid {r}/nginx.pid;\nevents {{ worker_connections 256; }}\nhttp {{ client_body_temp_path {r}/body; proxy_temp_path {r}/proxy; upstream hd_test_origin {{ server unix:{r}/origin.sock; }} upstream hd_test_cache {{ server unix:{r}/cache.sock; }}\n'+edge+'\nadd_header X-HD-Test-Family $hd_edge_family always;\nadd_header X-HD-Test-Limit $limit_req_status always;\n'+config+'\n}\n'
        (r/'nginx.conf').write_text(full);cls.log=(r/'nginx.log').open('wb');cls.addClassCleanup(cls.log.close);cls.process=subprocess.Popen([NGINX,'-e',str(r/'bootstrap.log'),'-p',str(r)+'/', '-c',str(r/'nginx.conf'),'-g','daemon off;'],stdout=cls.log,stderr=cls.log)
        def stop():
            if cls.process.poll() is None:cls.process.terminate();cls.process.wait(timeout=8)
        cls.addClassCleanup(stop)
        for _ in range(80):
            if cls.process.poll() is not None:
                raise RuntimeError((r/'nginx.log').read_text()+(r/'bootstrap.log').read_text())
            if (r/'tls.sock').is_socket():break
            time.sleep(.05)
        else:raise RuntimeError('Isolated nginx socket did not start')
    def request(self,host,path,headers=None,tls=True,method='GET',paced=True,body=None):
        # Exercise routing without overrunning the unchanged 8r/s production
        # SSR limiter as the independent boundary cases share one Unix peer.
        if paced:time.sleep(.14)
        r=self.root;s=socket.socket(socket.AF_UNIX);s.settimeout(5);s.connect(str(r/('tls.sock' if tls else 'http.sock')))
        if tls:s=ssl.create_default_context(cafile=str(r/'cert.pem')).wrap_socket(s,server_hostname=host)
        with s:
            values={'Host':host,'Connection':'close',**(headers or {})}
            if body is not None:
                values['Content-Length']=str(len(body))
            message=(method+' '+path+' HTTP/1.1\r\n'+''.join(k+': '+v+'\r\n' for k,v in values.items())+'\r\n').encode()
            s.sendall(message+(body or b''))
            res=http.client.HTTPResponse(s,method=method);res.begin()
            headers={k.lower():v for k,v in res.getheaders()}
            for name in ('Cache-Control','Strict-Transport-Security','X-Content-Type-Options'):
                if values:=res.headers.get_all(name):
                    headers[name.lower()]=', '.join(values)
            return res.status,headers,res.read()
    def test_hsts_is_scoped_to_matching_tls_hosts_and_preserves_response_policy(self):
        public='cars.hongdingauto.com'
        admin='admin.hongdingauto.com'
        for host,path,expected_status,expected_cache in (
            (public,'/en/',200,'no-store'),  # Cache hit.
            (public,'/ru/',200,'no-store'),  # Cache origin error, then dynamic Web.
            (public,'/zh/guide/',200,'public, max-age=600'),
            (public,'/api/v1/vehicles',200,'no-store'),
            (public,'/_next/static/missing.js',404,'no-store'),
            (admin,'/admin/',200,'no-store'),
            (admin,'/admin/assets/index-Abc12345.js',200,'public, max-age=31536000, immutable'),
            (admin,'/api/v1/analytics/events',404,'no-store'),
        ):
            with self.subTest(host=host,path=path):
                status,headers,_=self.request(host,path)
                self.assertEqual(status,expected_status)
                self.assertEqual(headers['cache-control'],expected_cache)
                self.assertEqual(headers['strict-transport-security'],'max-age=300')
        for host,other in ((public,admin),(admin,public)):
            status,headers,_=self.request(host,'/',tls=False)
            self.assertEqual(status,308)
            self.assertNotIn('strict-transport-security',headers)
            status,headers,_=self.request(host,'/',{'Host':other})
            self.assertEqual(status,421)
            self.assertNotIn('strict-transport-security',headers)
        status,headers,body=self.request('localhost','/health/proxy',tls=False)
        self.assertEqual((status,body),(200,b'ok'))
        self.assertEqual(headers['x-content-type-options'],'nosniff')
        self.assertNotIn('strict-transport-security',headers)
    def test_sitemap_off_switch_public_generation_and_retained_shard(self):
        host='cars.hongdingauto.com'
        root=self.root/'sitemap'
        spec=importlib.util.spec_from_file_location('sitemap',HERE/'production/sitemap-release.py')
        sitemap=importlib.util.module_from_spec(spec);spec.loader.exec_module(sitemap)
        old=sitemap.prepare(root,'https://'+host,[{'path':'/zh/'}])['generation']
        shard=f'/sitemap-{old}-00001.xml'
        status,headers,body=self.request(host,'/sitemap.xml')
        self.assertEqual((status,json.loads(body)['path']),(200,'/sitemap.xml'))
        self.assertEqual(headers['strict-transport-security'],'max-age=300')
        self.assertEqual(headers['x-content-type-options'],'nosniff')
        self.assertEqual(self.request(host,shard)[0],404)

        sitemap.activate(root,old,None)
        self.addCleanup(lambda: sitemap.deactivate(root,sitemap.current(root)) if sitemap.current(root) else None)
        status,headers,body=self.request(host,'/sitemap.xml')
        self.assertEqual((status,headers['content-type'],headers['cache-control']),
                         (200,'application/xml','no-store'))
        self.assertEqual(headers['strict-transport-security'],'max-age=300')
        self.assertEqual(headers['x-content-type-options'],'nosniff')
        self.assertNotIn('etag',headers)
        self.assertIn(('https://'+host+shard).encode(),body)
        status,headers,body=self.request(host,shard)
        self.assertEqual((status,headers['content-type']),(200,'application/xml'))
        self.assertEqual(headers['strict-transport-security'],'max-age=300')
        self.assertEqual(headers['x-content-type-options'],'nosniff')
        self.assertIn(b'<loc>https://cars.hongdingauto.com/zh/</loc>',body)

        new=sitemap.prepare(root,'https://'+host,[{'path':'/ru/'}])['generation']
        self.assertEqual(self.request(host,f'/sitemap-{new}-00001.xml')[0],404)
        sitemap.activate(root,new,old)
        self.assertEqual(self.request(host,shard)[0],200)
        self.assertEqual(self.request('admin.hongdingauto.com',shard)[0],404)
        sitemap.deactivate(root,new)
        self.assertEqual(self.request(host,shard)[0],404)
        status,_,body=self.request(host,'/sitemap.xml')
        self.assertEqual((status,json.loads(body)['path']),(200,'/sitemap.xml'))

    def test_analytics_accepts_only_the_exact_public_same_origin_post(self):
        host='cars.hongdingauto.com'
        headers={'Origin':'https://'+host,'Content-Type':'application/json'}
        private={'Cookie':'synthetic-session=private','Authorization':'synthetic-auth',
                 'Referer':'https://'+host+'/zh/?private=1','X-HD-SSR-Key':'synthetic-forgery'}
        Origin.calls.clear()
        status,response,body=self.request(host,ANALYTICS_PATH,{**headers,**private},method='POST',body=ANALYTICS_BODY)
        self.assertEqual((status,response['cache-control']),(200,'no-store'))
        upstream=json.loads(body)
        self.assertEqual(upstream['data'],json.loads(ANALYTICS_BODY))
        self.assertEqual(upstream['headers']['Origin'],headers['Origin'])
        self.assertTrue({name.lower() for name in private}.isdisjoint(name.lower() for name in upstream['headers']))
        for domain,path,method,origin,amount,expected in (
            (host,ANALYTICS_PATH,'GET',headers['Origin'],None,405),
            (host,ANALYTICS_PATH,'OPTIONS','https://outside.invalid',None,405),
            (host,ANALYTICS_PATH,'POST','https://outside.invalid',ANALYTICS_BODY,403),
            (host,ANALYTICS_PATH,'POST',None,ANALYTICS_BODY,403),
            (host,ANALYTICS_PATH+'?ignored=1','POST',headers['Origin'],ANALYTICS_BODY,400),
            (host,ANALYTICS_PATH,'POST',headers['Origin'],b' '*8193,413),
            (host,ANALYTICS_PATH+'/','POST',headers['Origin'],ANALYTICS_BODY,404),
            ('admin.hongdingauto.com',ANALYTICS_PATH,'POST',headers['Origin'],ANALYTICS_BODY,404),
            (host,'/api/v1/admin/analytics/overview?days=7','GET',None,None,404),
        ):
            with self.subTest(domain=domain,path=path,method=method,origin=origin):
                request_headers={'Origin':origin} if origin else {}
                response=self.request(domain,path,request_headers,method=method,body=amount)
                self.assertEqual(response[0],expected)
        self.assertEqual(Origin.calls,[ANALYTICS_PATH])

    def test_analytics_limit_uses_the_direct_peer_and_keeps_catalog_available(self):
        host='cars.hongdingauto.com'
        headers={'Origin':'https://'+host,'Content-Type':'application/json'}
        with ThreadPoolExecutor(max_workers=12) as pool:
            replies=list(pool.map(lambda i:self.request(host,ANALYTICS_PATH,
                {**headers,'X-Forwarded-For':f'203.0.113.{i}'},method='POST',paced=False,body=ANALYTICS_BODY),range(36)))
        self.assertEqual({status for status,_,_ in replies},{200,429})
        self.assertTrue(all(response['cache-control']=='no-store' for _,response,_ in replies))
        self.assertEqual(self.request(host,'/api/v1/vehicles')[0],200)

    def test_contact_count_keeps_only_the_anonymous_same_origin_post(self):
        host = 'cars.hongdingauto.com'
        origin = 'https://' + host
        payload = {'vehicleId': MEDIA_ID, 'channel': 'whatsapp'}
        body = json.dumps(payload).encode()
        headers = {'Origin': origin, 'Content-Type': 'application/json'}
        private = {'Cookie': 'synthetic=private', 'Referer': origin + '/zh/?private=1',
                   'Authorization': 'synthetic', 'X-HD-SSR-Key': 'synthetic'}
        Origin.calls.clear()
        status, response, reply = self.request(host, CONTACT_COUNT_PATH, {**headers, **private},
                                               method='POST', body=body)
        self.assertEqual((status, response.get('cache-control')), (200, 'no-store'))
        self.assertNotIn('set-cookie', response)
        forwarded = json.loads(reply)
        self.assertEqual(forwarded['data'], payload)
        self.assertTrue({name.lower() for name in private}.isdisjoint(name.lower() for name in forwarded['headers']))
        cases = [(host, CONTACT_COUNT_PATH, 'GET', origin, None, 405),
                 (host, CONTACT_COUNT_PATH, 'POST', 'https://outside.invalid', body, 403),
                 (host, CONTACT_COUNT_PATH + '?private=1', 'POST', origin, body, 400),
                 (host, CONTACT_COUNT_PATH, 'POST', origin, b' ' * 513, 413),
                 (host, CONTACT_COUNT_PATH + '/', 'POST', origin, body, 404),
                 ('admin.hongdingauto.com', CONTACT_COUNT_PATH, 'POST', origin, body, 404)]
        for domain, path, method, request_origin, data, expected in cases:
            with self.subTest(domain=domain, path=path, method=method, expected=expected):
                result = self.request(domain, path, {**headers, 'Origin': request_origin}, method=method, body=data)
                self.assertEqual(result[0], expected)
        self.assertEqual(Origin.calls, [CONTACT_COUNT_PATH])

    def test_admin_robots_disallows_all_paths(self):
        status,headers,body=self.request('admin.hongdingauto.com','/robots.txt')
        self.assertEqual((status,body),(200,b'User-agent: *\nDisallow: /\n'))
        self.assertEqual(headers['content-type'],'text/plain')
        self.assertEqual(headers['x-content-type-options'],'nosniff')
        status,headers,body=self.request('cars.hongdingauto.com','/robots.txt')
        self.assertEqual((status,json.loads(body)['path']),(200,'/robots.txt'))
        self.assertEqual(headers['x-content-type-options'],'nosniff')
        self.assertEqual(headers['strict-transport-security'],'max-age=300')
        self.assertEqual(headers['cache-control'],'no-store')

    def test_public_media_preserves_validator_across_redirect_and_rechecks_visibility(self):
        host='cars.hongdingauto.com'
        validators={}
        for variant,(_,expected_body) in MEDIA_REPRESENTATIONS.items():
            path=MEDIA_PATH+'?variant='+variant
            status,headers,body=self.request(host,path)
            self.assertEqual((status,body),(200,expected_body))
            self.assertEqual(headers['cache-control'],'private, no-cache')
            self.assertEqual(headers['etag'],'"test-'+variant+'"')
            self.assertNotIn('last-modified',headers)
            self.assertEqual(headers['x-content-type-options'],'nosniff')
            validators[variant]=headers['etag']
            Origin.calls.clear()
            status,headers,body=self.request(host,path,{'If-None-Match':validators[variant]})
            self.assertEqual((status,body),(304,b''))
            self.assertEqual(headers['cache-control'],'private, no-cache')
            self.assertEqual(headers['etag'],validators[variant])
            self.assertEqual(Origin.calls,[path])
        original=self.root/'media'/(MEDIA_ID+'.webp')
        moved=original.with_suffix('.unavailable')
        original.rename(moved)
        try:
            status,headers,_=self.request(host,MEDIA_PATH,{'If-None-Match':validators['thumb']})
            self.assertEqual(status,404)
            self.assertEqual(headers['cache-control'],'no-store')
            self.assertNotIn('etag',headers)
        finally:
            moved.rename(original)
        status,headers,body=self.request(host,MEDIA_PATH,{'If-None-Match':validators['thumb'],'Range':'bytes=0-1'})
        self.assertEqual((status,body),(200,MEDIA_REPRESENTATIONS['original'][1]))
        Origin.media_visible=False
        try:
            for condition in [validators['original'],'*']:
                status,headers,_=self.request(host,MEDIA_PATH,{'If-None-Match':condition})
                self.assertEqual(status,404)
                self.assertEqual(headers['cache-control'],'no-store')
                self.assertNotIn('etag',headers)
        finally:
            Origin.media_visible=True
    def test_media_internal_paths_and_private_preview_do_not_adopt_public_policy(self):
        for host in ['cars.hongdingauto.com','admin.hongdingauto.com']:
            for prefix in ['/_hd_media/','/_hd_public_media/']:
                Origin.calls.clear()
                status,_,_=self.request(host,prefix+MEDIA_ID+'.webp',{'If-None-Match':'"test-original"'})
                self.assertEqual(status,404)
                self.assertEqual(Origin.calls,[])
        status,headers,body=self.request('admin.hongdingauto.com',MEDIA_PREVIEW,
            {'Cookie':'test-session=yes','If-None-Match':'"test-original"'})
        self.assertEqual((status,body),(200,MEDIA_REPRESENTATIONS['original'][1]))
        self.assertEqual(headers['cache-control'],'no-store')
        self.assertNotIn('etag',headers)
        status,headers,body=self.request('admin.hongdingauto.com',MEDIA_PREVIEW,
            {'Cookie':'test-session=yes','If-None-Match':'*'})
        self.assertEqual((status,body),(200,MEDIA_REPRESENTATIONS['original'][1]))
        self.assertEqual(headers['cache-control'],'no-store')
        self.assertNotIn('etag',headers)
        status,headers,_=self.request('admin.hongdingauto.com',MEDIA_PREVIEW,{'If-None-Match':'*'})
        self.assertEqual(status,404)
        self.assertEqual(headers['cache-control'],'no-store')
    def test_build_assets_only_have_long_cache_and_missing_assets_never_do(self):
        for path,status in [('/_next/static/chunks/chunk-12345678.js',200),('/_next/static/chunks/partial-12345678.js',206),('/_next/static/build-12345678/_buildManifest.js',304)]:
            actual,headers,_=self.request('cars.hongdingauto.com',path);self.assertEqual(actual,status);self.assertEqual(headers['cache-control'],'public, max-age=31536000, immutable')
        status,headers,_=self.request('cars.hongdingauto.com','/_next/static/missing.js');self.assertEqual(status,404);self.assertEqual(headers['cache-control'],'no-store')
        for path,status,cache in [('/admin/assets/index-Abc12345.js',200,'public, max-age=31536000, immutable'),('/admin/assets/missing-Abc12345.js',404,'no-store'),('/admin/assets/plain.js',200,'no-store'),('/admin/vehicles',200,'no-store')]:
            actual,headers,_=self.request('admin.hongdingauto.com',path);self.assertEqual(actual,status);self.assertEqual(headers['cache-control'],cache)
            self.assertEqual(headers['x-content-type-options'],'nosniff')
    def test_internal_paths_are_denied_on_both_hosts_and_transports(self):
        for host in ['cars.hongdingauto.com','admin.hongdingauto.com']:
            for tls in [False,True]:
                for path in ['/internal','/internal/public-catalog/version','/internal/public-catalog/vehicles']:
                    self.assertEqual(self.request(host,path,tls=tls)[0],404)
    def test_admin_staff_preview_and_its_build_assets_share_the_admin_origin(self):
        path='/staff/vehicles/11111111-1111-4111-8111-111111111111/publication-preview/?locale=zh&loadId=22222222-2222-4222-8222-222222222222'
        status,headers,body=self.request('admin.hongdingauto.com',path,{'Cookie':'synthetic-session=private'})
        self.assertEqual(status,200);self.assertEqual(headers['cache-control'],'private, no-store');self.assertEqual(headers['x-robots-tag'],'noindex, nofollow')
        self.assertEqual(headers['strict-transport-security'],'max-age=300');self.assertEqual(headers['x-content-type-options'],'nosniff')
        self.assertEqual(headers['x-frame-options'],'SAMEORIGIN');self.assertEqual(headers['content-security-policy'],"frame-ancestors 'self'");self.assertEqual(headers['referrer-policy'],'same-origin')
        self.assertEqual(json.loads(body)['headers']['Cookie'],'synthetic-session=private')
        self.assertEqual(self.request('admin.hongdingauto.com',path,method='HEAD')[0],200)
        self.assertEqual(self.request('admin.hongdingauto.com',path,method='POST')[0],403)
        for tls in [False,True]:self.assertEqual(self.request('cars.hongdingauto.com',path,tls=tls)[0],404)
        for blocked in ['/staff/','/staff/vehicles/not-a-uuid/publication-preview/','/staff/vehicles/11111111-1111-4111-8111-111111111111/other','/fonts/other.woff2']:
            self.assertEqual(self.request('admin.hongdingauto.com',blocked)[0],404)
        status,headers,_=self.request('admin.hongdingauto.com','/_next/static/chunks/chunk-12345678.js',{'Cookie':'synthetic-session=private','Authorization':'synthetic-auth'})
        self.assertEqual(status,200);self.assertEqual(headers['cache-control'],'public, max-age=31536000, immutable')
        self.assertEqual(self.request('admin.hongdingauto.com','/_next/static/missing.js')[1]['cache-control'],'no-store')
        for name in ['latin','cyrillic']:
            status,headers,body=self.request('admin.hongdingauto.com','/fonts/inter-'+name+'.woff2',{'Cookie':'synthetic-session=private','Authorization':'synthetic-auth'})
            self.assertEqual(status,200);self.assertEqual(headers['cache-control'],'no-store');upstream=json.loads(body)['headers']
            self.assertFalse(any(k.lower() in ['cookie','authorization','x-hd-ssr-key'] for k in upstream))
    def test_visitor_service_identity_is_removed_and_html_policy_preserved(self):
        for path in ['/api/v1/vehicles','/zh/cars/']:
            status,headers,body=self.request('cars.hongdingauto.com',path,{'X-HD-SSR-Key':'synthetic-forgery','X-Forwarded-For':'203.0.113.55'});self.assertEqual(status,200);self.assertEqual(headers['cache-control'],'no-store');origin=json.loads(body)['headers'];self.assertFalse(any(k.lower()=='x-hd-ssr-key' for k in origin));self.assertNotEqual(origin.get('X-Forwarded-For'),'203.0.113.55')
        self.assertEqual(self.request('cars.hongdingauto.com','/zh/guide/')[1]['cache-control'],'public, max-age=600')
    def test_cache_controls_are_private_on_api_web_and_home_cache_hops(self):
        forged={name:'synthetic-forgery' for name in CACHE_CONTROL_HEADERS}
        hidden={name.lower() for name in CACHE_CONTROL_HEADERS}
        for path in ['/api/v1/vehicles','/zh/guide/','/en/']:
            with self.subTest(path=path):
                status, headers, body = self.request('cars.hongdingauto.com', path, forged)
                self.assertEqual(status, 200)
                self.assertTrue(hidden.isdisjoint(headers))
                self.assertTrue(hidden.isdisjoint(name.lower() for name in json.loads(body)['headers']))
    def test_home_cache_falls_back_to_web_and_hits_keep_edge_limits(self):
        host='cars.hongdingauto.com'
        Origin.calls.clear();CacheOrigin.calls.clear()
        self.assertEqual(self.request(host,'/en/',method='HEAD')[0],200)
        self.assertEqual(self.request(host,'/ru/',{'Accept':'text/html'})[0],200)
        self.assertEqual(CacheOrigin.calls,['/ru/'])
        self.assertEqual(Origin.calls,['/en/','/ru/'])
        time.sleep(2.3)
        try:
            with ThreadPoolExecutor(max_workers=16) as pool:
                statuses=list(pool.map(lambda _:self.request(host,'/en/',{'Accept':'text/html'},paced=False)[0],range(48)))
            self.assertIn(200,statuses)
            self.assertIn(429,statuses)
            self.assertTrue(all(status in (200,429) for status in statuses))
            self.assertEqual(CacheOrigin.calls.count('/en/'),statuses.count(200))
        finally:time.sleep(2.3)
    def test_public_catalog_json_negotiates_gzip_without_changing_body_or_cache_policy(self):
        paths=[('/api/v1/vehicles/', '/api/v1/vehicles'), ('/api/v1/vehicle-filters/', '/api/v1/vehicle-filters'),
               ('/catalog-facets.json', '/catalog-facets.json')]
        for path,upstream in paths:
            with self.subTest(path=path):
                query='?'+CATALOG_QUERY
                for accept in ['gzip','gzip;q=0',None]:
                    request_headers={'Via':'1.1 synthetic-proxy'}
                    if accept is not None:request_headers['Accept-Encoding']=accept
                    Origin.calls.clear()
                    status,headers,body=self.request('cars.hongdingauto.com',path+query,request_headers)
                    self.assertEqual(status,200)
                    self.assertEqual(Origin.calls,[upstream+query])
                    self.assertEqual(headers['cache-control'],'no-store')
                    self.assertIn('accept-encoding',headers.get('vary','').lower().split(', '))
                    if accept=='gzip':
                        self.assertEqual(headers.get('content-encoding'),'gzip')
                        self.assertLess(len(body),len(CATALOG_JSON))
                        body=gzip.decompress(body)
                    else:self.assertNotIn('content-encoding',headers)
                    self.assertEqual(body,CATALOG_JSON)
    def test_catalog_gzip_does_not_extend_to_admin_media_or_other_web_routes(self):
        routes=[('admin.hongdingauto.com','/api/v1/vehicles'),
                ('cars.hongdingauto.com','/api/v1/media/example'),
                ('cars.hongdingauto.com','/zh/cars/')]
        for host,path in routes:
            with self.subTest(host=host,path=path):
                status,headers,body=self.request(host,path+'?'+CATALOG_QUERY,{'Accept-Encoding':'gzip'})
                self.assertEqual(status,200)
                self.assertNotIn('content-encoding',headers)
                self.assertEqual(body,CATALOG_JSON)
    def test_only_bounded_public_segments_are_added_to_the_public_allowlist(self):
        vehicle='11111111-1111-4111-8111-111111111111'
        for kind in ['gallery','configuration','inspection','price-history']:
            path='/api/v1/vehicles/'+vehicle+'/'+kind
            status,headers,body=self.request('cars.hongdingauto.com',path+'/?locale=ru&limit=20',{'X-HD-SSR-Key':'synthetic-forgery','X-HD-Visitor-IP':'203.0.113.55'})
            self.assertEqual(status,200);self.assertEqual(headers['cache-control'],'no-store')
            self.assertEqual(headers['x-hd-test-family'],'public-api')
            origin=json.loads(body);self.assertEqual(origin['path'],path+'?locale=ru&limit=20')
            self.assertFalse(any(k.lower() in ['x-hd-ssr-key','x-hd-visitor-ip'] for k in origin['headers']))
            self.assertEqual(self.request('cars.hongdingauto.com',path,method='HEAD')[0],200)
            Origin.calls.clear();self.assertEqual(self.request('cars.hongdingauto.com',path,method='POST')[0],405);self.assertEqual(Origin.calls,[])
        for suffix in ['activity','private','gallery/private','inspection/private','price-history/private']:
            Origin.calls.clear();self.assertEqual(self.request('cars.hongdingauto.com','/api/v1/vehicles/'+vehicle+'/'+suffix)[0],404);self.assertEqual(Origin.calls,[])
    def test_public_segments_share_the_unchanged_direct_peer_request_limit(self):
        time.sleep(2.3)
        paths=['/api/v1/vehicles/11111111-1111-4111-8111-111111111111/'+kind for kind in ['gallery','configuration','inspection','price-history']]
        try:
            with ThreadPoolExecutor(max_workers=16) as pool:
                replies=list(pool.map(lambda i:self.request('cars.hongdingauto.com',paths[i%len(paths)],{'X-Forwarded-For':'203.0.113.'+str(i)},paced=False),range(80)))
            rejected=[headers for status,headers,_ in replies if status==429]
            self.assertTrue(rejected,'All bounded public segment routes must hit the real12r/s burst24 bucket')
            self.assertTrue(all(status in [200,429] for status,_,_ in replies),{status:sum(x[0]==status for x in replies) for status,_,_ in replies})
            self.assertTrue(all(headers.get('x-hd-test-family')=='public-api' and headers.get('x-hd-test-limit')=='REJECTED' for headers in rejected))
        finally:time.sleep(2.3)
    def test_missing_vehicle_documents_keep_404_and_only_use_the_localized_html_fallback(self):
        for locale in ['zh','en','ru']:
            Origin.calls.clear()
            status,headers,body=self.request('cars.hongdingauto.com','/'+locale+'/cars/missing/?private=value',{'Accept':'text/html','Cookie':'synthetic-private','Authorization':'synthetic-auth'})
            self.assertEqual(status,404);self.assertIn(('readable '+locale+' missing vehicle').encode(),body,str(Origin.calls))
            self.assertEqual(headers['cache-control'],'private, no-store');self.assertIn('noindex',headers['x-robots-tag'])
            self.assertEqual(Origin.calls,['/'+locale+'/cars/missing/?private=value','/404/'+locale+'/'])
            self.assertEqual(self.request('cars.hongdingauto.com','/'+locale+'/cars/missing/',{'Accept':'text/html'},method='HEAD')[0],404)
        for headers in [{'Accept':'text/html','RSC':'1'},{'Accept':'text/html','Next-Router-Prefetch':'1'},{'Accept':'text/html','Next-Router-Segment-Prefetch':'/tree'},{'Accept':'text/html','Purpose':'prefetch'},{'Accept':'text/html','Sec-Purpose':'prefetch;prerender'},{'Accept':'application/json'}]:
            Origin.calls.clear()
            status,_,body=self.request('cars.hongdingauto.com','/zh/cars/missing/',headers)
            self.assertEqual(status,404);self.assertEqual(body,b'original missing response');self.assertEqual(Origin.calls,['/zh/cars/missing/'])
        for path,expected in [('unavailable',503),('limited',429),('present',200)]:
            Origin.calls.clear();self.assertEqual(self.request('cars.hongdingauto.com','/zh/cars/'+path+'/',{'Accept':'text/html'})[0],expected)
            self.assertEqual(Origin.calls,['/zh/cars/'+path+'/'])
if __name__=='__main__':unittest.main()
