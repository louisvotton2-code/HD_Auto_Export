import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {readConfig} from './config.js';
const base={DATABASE_URL:'postgresql://local:local@127.0.0.1:55432/test',AUTH_SECRET:'test-only-long-secret-which-is-not-used-in-production'};
test('translation defaults disabled; only trusted local service origins and explicit versions are accepted',()=>{
  assert.equal(readConfig(base).translation.provider,'disabled');
  for(const url of ['http://127.0.0.1:3340','http://localhost:3340','http://[::1]:3340','http://libretranslate:5000'])
    assert.equal(readConfig({...base,LIBRETRANSLATE_URL:url}).translation.libreUrl,url);
  for(const url of ['https://remote.example','file:///tmp/text','http://127.0.0.1:3340/translate','http://127.0.0.1:3340/?q=secret','http://user:password@localhost:3340'])
    assert.throws(()=>readConfig({...base,LIBRETRANSLATE_URL:url}),error=>error instanceof Error && error.message.includes('LIBRETRANSLATE_URL') && !error.message.includes('secret'));
});
test('Aliyun translation selects only the two fixed regions and does not echo invalid settings',()=>{
  assert.equal(readConfig(base).translation.region,'cn-hangzhou');
  for(const region of ['cn-hangzhou','ap-southeast-1'])assert.equal(readConfig({...base,ALI_MT_REGION:region}).translation.region,region);
  for(const region of ['','cn-beijing','AP-SOUTHEAST-1','mt.ap-southeast-1.aliyuncs.com','https://secret-endpoint.invalid'])
    assert.throws(()=>readConfig({...base,ALI_MT_REGION:region}),error=>error instanceof Error && error.message.includes('ALI_MT_REGION') && !error.message.includes('secret-endpoint'));
});
test('invalid configuration fails without printing credentials',()=>{
  assert.throws(()=>readConfig({...base,DATABASE_URL:'secret-value'}),e=>e instanceof Error&&e.message.includes('DATABASE_URL')&&!e.message.includes('secret-value'));
  assert.throws(()=>readConfig({...base,AUTH_SECRET:'short'}),/AUTH_SECRET/);
  assert.throws(()=>readConfig({...base,TRUSTED_ORIGINS:'*'}),/exact/);
  assert.throws(()=>readConfig({...base,NODE_ENV:'production'}),/HTTPS/);
  assert.throws(()=>readConfig({...base,AUTH_BASE_URL:'http://127.0.0.1:3318/admin'}),/without a path/);
});

test('media delivery is direct by default and nginx is an explicit fixed option',()=>{
  assert.equal(readConfig(base).mediaDelivery,'direct');
  assert.equal(readConfig({...base,MEDIA_DELIVERY:'nginx'}).mediaDelivery,'nginx');
  for(const value of ['true','NGINX','', '/private/files', 'https://example.invalid']) {
    assert.throws(()=>readConfig({...base,MEDIA_DELIVERY:value}),/MEDIA_DELIVERY/);
  }
});

test('proxy trust defaults to none and accepts only explicit addresses or bounded networks',()=>{
  assert.equal(readConfig(base).trustProxy,false);
  assert.equal(readConfig({...base,TRUST_PROXY:'false'}).trustProxy,false);
  assert.equal(readConfig({...base,TRUST_PROXY:'loopback'}).trustProxy,'loopback');
  assert.deepEqual(readConfig({...base,TRUST_PROXY:'172.29.0.2/32'}).trustProxy,['172.29.0.2/32']);
  assert.deepEqual(readConfig({...base,TRUST_PROXY:'172.29.0.2, 172.30.0.0/24, fd42::2/128, fd43::/64'}).trustProxy,
    ['172.29.0.2','172.30.0.0/24','fd42::2/128','fd43::/64']);
  assert.deepEqual(readConfig({...base,TRUST_PROXY:'fd42::2'}).trustProxy,['fd42::2']);
});

test('proxy trust rejects permissive, ambiguous and malformed values without echoing input',()=>{
  for(const value of ['true','1','*','uniquelocal','linklocal','localhost','proxy.internal','false,172.29.0.2','loopback,172.29.0.2',
    '',' ','172.29.0.2,',',172.29.0.2','172.29.0.2,,172.29.0.3','172.029.0.2','172.29.0.256','172.29.0.2:3320',
    '0.0.0.0/0','172.0.0.0/8','172.29.0.0/23','172.29.0.2/33','172.29.0.2/032','172.29.0.2/255.255.255.0',
    '172.29.0.2/-1','172.29.0.2/','172.29.0.2/32/32','::/0','::/64','::/80','::abcd:0:0/81','fd42::/63','fd42::/129','[fd42::2]','fe80::1%eth0',
    '::ffff:0.0.0.0/96','::ffff:ac1d:2/128','http://secret-proxy.invalid',Array(33).fill('172.29.0.2').join(',')]) {
    assert.throws(()=>readConfig({...base,TRUST_PROXY:value}),error=>error instanceof Error&&error.message.startsWith('TRUST_PROXY')&&!error.message.includes('secret-proxy'),value);
  }
});

test('proxy allowlist accepts the configured peer and stops at an untrusted immediate or intermediate peer',async()=>{
  const app=Fastify({trustProxy:readConfig({...base,TRUST_PROXY:'172.29.0.2/32,fd42::2/128'}).trustProxy});
  app.get('/',request=>({ip:request.ip}));
  try {
    const cases=[
      {peer:'172.29.0.2',forwarded:'198.51.100.9',expected:'198.51.100.9'},
      {peer:'::ffff:172.29.0.2',forwarded:'198.51.100.9',expected:'198.51.100.9'},
      {peer:'172.29.0.3',forwarded:'198.51.100.9',expected:'172.29.0.3'},
      {peer:'198.51.100.10',forwarded:'172.29.0.2, 198.51.100.9',expected:'198.51.100.10'},
      {peer:'172.29.0.2',forwarded:'198.51.100.9, 172.29.0.3',expected:'172.29.0.3'},
      {peer:'fd42::2',forwarded:'2001:db8::9',expected:'2001:db8::9'},
      {peer:'fd42::3',forwarded:'2001:db8::9',expected:'fd42::3'},
    ];
    for(const {peer,forwarded,expected} of cases) {
      const response=await app.inject({url:'/',remoteAddress:peer,headers:{'x-forwarded-for':forwarded}});
      assert.equal(response.statusCode,200);assert.equal(response.json().ip,expected,peer);
    }
  } finally {await app.close();}
});

test('default proxy configuration ignores spoofed forwarding headers',async()=>{
  const app=Fastify({trustProxy:readConfig(base).trustProxy});
  app.get('/',request=>({ip:request.ip}));
  try {
    const response=await app.inject({url:'/',remoteAddress:'172.29.0.2',headers:{'x-forwarded-for':'198.51.100.9'}});
    assert.equal(response.json().ip,'172.29.0.2');
  } finally {await app.close();}
});
