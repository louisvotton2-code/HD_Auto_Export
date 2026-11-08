import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfig} from './config.js';
const base={DATABASE_URL:'postgresql://local:local@127.0.0.1:55432/test',AUTH_SECRET:'test-only-long-secret-which-is-not-used-in-production'};
test('invalid configuration fails without printing credentials',()=>{
  assert.throws(()=>readConfig({...base,DATABASE_URL:'secret-value'}),e=>e instanceof Error&&e.message.includes('DATABASE_URL')&&!e.message.includes('secret-value'));
  assert.throws(()=>readConfig({...base,AUTH_SECRET:'short'}),/AUTH_SECRET/);
  assert.throws(()=>readConfig({...base,TRUSTED_ORIGINS:'*'}),/exact/);
  assert.throws(()=>readConfig({...base,NODE_ENV:'production'}),/HTTPS/);
  assert.throws(()=>readConfig({...base,AUTH_BASE_URL:'http://127.0.0.1:3318/admin'}),/without a path/);
});
