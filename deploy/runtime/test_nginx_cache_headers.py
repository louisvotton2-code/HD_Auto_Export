"""Exercise the actual domain config over private Unix TLS, never a public listener."""
import http.client, http.server, json, os, pathlib, shutil, socket, socketserver, ssl, subprocess, tempfile, threading, time, unittest
from concurrent.futures import ThreadPoolExecutor
HERE=pathlib.Path(__file__).resolve().parent
NGINX=shutil.which('nginx')
class Origin(http.server.BaseHTTPRequestHandler):
    calls=[]
    def do_GET(self):
        self.calls.append(self.path)
        known={'/_next/static/chunks/chunk-12345678.js':200,'/_next/static/chunks/partial-12345678.js':206,'/_next/static/build-12345678/_buildManifest.js':304}
        status=known.get(self.path,404 if self.path.startswith('/_next/static/') else 200)
        body=json.dumps({'headers':dict(self.headers.items()),'path':self.path}).encode() if not self.path.startswith('/_next/static/') else b'code'
        content_type='application/json'
        if '/cars/missing/' in self.path:
            status=404;content_type='text/x-component' if self.headers.get('RSC') else 'text/html';body=b'original missing response'
        elif '/cars/unavailable/' in self.path:status=503;body=b'original unavailable'
        elif '/cars/limited/' in self.path:status=429;body=b'original limited'
        elif self.path.startswith('/404/'):
            content_type='text/html';body=('<html>readable '+self.path.split('/')[2]+' missing vehicle</html>').encode()
        self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Cache-Control','public, max-age=600' if self.path=='/zh/guide/' else 'no-store')
        if self.path.startswith('/staff/'):
            self.send_header('X-Frame-Options','SAMEORIGIN');self.send_header('Content-Security-Policy',"frame-ancestors 'self'");self.send_header('Referrer-Policy','same-origin')
        self.send_header('Content-Length',str(len(body) if status!=304 else 0));self.end_headers()
        if status!=304 and self.command!='HEAD':self.wfile.write(body)
    do_HEAD=do_GET
    def log_message(self,*args):pass
class UnixHttp(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):
    daemon_threads=True
    request_queue_size=64  # Synthetic origin must accept the bounded16-client rate probe.
@unittest.skipUnless(NGINX and shutil.which('openssl'),'native nginx and openssl are required for the real header test')
class DomainCacheHeaders(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='hd-rel03-edge-');cls.addClassCleanup(cls.temp.cleanup);cls.root=pathlib.Path(cls.temp.name);r=cls.root
        for n in ['admin/assets','body','proxy']:(r/n).mkdir(parents=True)
        (r/'admin/index.html').write_text('admin');(r/'admin/assets/index-Abc12345.js').write_text('hashed');(r/'admin/assets/plain.js').write_text('plain')
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=cars.hongdingauto.com','-addext','subjectAltName=DNS:cars.hongdingauto.com,DNS:admin.hongdingauto.com','-keyout',str(r/'key.pem'),'-out',str(r/'cert.pem')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        (r/'key.pem').chmod(0o600)
        cls.backend=UnixHttp(str(r/'origin.sock'),Origin);cls.thread=threading.Thread(target=cls.backend.serve_forever,daemon=True);cls.thread.start();cls.addClassCleanup(cls.backend.server_close);cls.addClassCleanup(cls.backend.shutdown)
        includes=r/'includes';shutil.copytree(HERE/'nginx-domains',includes)
        for fragment in includes.glob('*.conf'):fragment.write_text(fragment.read_text().replace('/etc/nginx/hd-domains',str(includes)))
        config=(HERE/'nginx-domains.conf').read_text().replace('/etc/nginx/hd-domains',str(includes)).replace('/run/tls/current/server.crt',str(r/'cert.pem')).replace('/run/tls/current/server.key',str(r/'key.pem')).replace('http://api:3320','http://hd_test_origin').replace('http://web:3000','http://hd_test_origin').replace('root /srv;',f'root {r};').replace('listen 8080',f'listen unix:{r}/http.sock').replace('listen 8443',f'listen unix:{r}/tls.sock')
        # Keep the production edge protections; only fixture paths and transport differ.
        edge=(HERE/'nginx-edge.conf').read_text()
        # Darwin's larger pages require a larger bookkeeping zone; rate/burst/connection limits are identical.
        if os.uname().sysname=='Darwin':edge=edge.replace('zone=hd_edge_total:64k','zone=hd_edge_total:256k')
        rootuser='user root;\n' if os.getuid()==0 else ''
        full=rootuser+f'worker_processes 1;\npid {r}/nginx.pid;\nevents {{ worker_connections 256; }}\nhttp {{ client_body_temp_path {r}/body; proxy_temp_path {r}/proxy; upstream hd_test_origin {{ server unix:{r}/origin.sock; }}\n'+edge+'\nadd_header X-HD-Test-Family $hd_edge_family always;\nadd_header X-HD-Test-Limit $limit_req_status always;\n'+config+'\n}\n'
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
    def request(self,host,path,headers=None,tls=True,method='GET',paced=True):
        # Exercise routing without overrunning the unchanged 8r/s production
        # SSR limiter as the independent boundary cases share one Unix peer.
        if paced:time.sleep(.14)
        r=self.root;s=socket.socket(socket.AF_UNIX);s.settimeout(5);s.connect(str(r/('tls.sock' if tls else 'http.sock')))
        if tls:s=ssl.create_default_context(cafile=str(r/'cert.pem')).wrap_socket(s,server_hostname=host)
        with s:
            values={'Host':host,'Connection':'close',**(headers or {})};s.sendall((method+' '+path+' HTTP/1.1\r\n'+''.join(k+': '+v+'\r\n' for k,v in values.items())+'\r\n').encode());res=http.client.HTTPResponse(s,method=method);res.begin();return res.status,dict((k.lower(),v) for k,v in res.getheaders()),res.read()
    def test_build_assets_only_have_long_cache_and_missing_assets_never_do(self):
        for path,status in [('/_next/static/chunks/chunk-12345678.js',200),('/_next/static/chunks/partial-12345678.js',206),('/_next/static/build-12345678/_buildManifest.js',304)]:
            actual,headers,_=self.request('cars.hongdingauto.com',path);self.assertEqual(actual,status);self.assertEqual(headers['cache-control'],'public, max-age=31536000, immutable')
        status,headers,_=self.request('cars.hongdingauto.com','/_next/static/missing.js');self.assertEqual(status,404);self.assertEqual(headers['cache-control'],'no-store')
        for path,status,cache in [('/admin/assets/index-Abc12345.js',200,'public, max-age=31536000, immutable'),('/admin/assets/missing-Abc12345.js',404,'no-store'),('/admin/assets/plain.js',200,'no-store'),('/admin/vehicles',200,'no-store')]:
            actual,headers,_=self.request('admin.hongdingauto.com',path);self.assertEqual(actual,status);self.assertEqual(headers['cache-control'],cache)
    def test_internal_paths_are_denied_on_both_hosts_and_transports(self):
        for host in ['cars.hongdingauto.com','admin.hongdingauto.com']:
            for tls in [False,True]:
                for path in ['/internal','/internal/public-catalog/version','/internal/public-catalog/vehicles']:
                    self.assertEqual(self.request(host,path,tls=tls)[0],404)
    def test_admin_staff_preview_and_its_build_assets_share_the_admin_origin(self):
        path='/staff/vehicles/11111111-1111-4111-8111-111111111111/publication-preview/?locale=zh&loadId=22222222-2222-4222-8222-222222222222'
        status,headers,body=self.request('admin.hongdingauto.com',path,{'Cookie':'synthetic-session=private'})
        self.assertEqual(status,200);self.assertEqual(headers['cache-control'],'private, no-store');self.assertEqual(headers['x-robots-tag'],'noindex, nofollow')
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
