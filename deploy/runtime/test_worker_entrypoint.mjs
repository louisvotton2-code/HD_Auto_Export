import assert from 'node:assert/strict';
import test from 'node:test';
import {workerEnvironment, workerInvocation} from './production/worker-entrypoint.mjs';

const approved = {HD_DEPLOYMENT_ENV: 'production', HD_RELEASE_ID: 'a'.repeat(40),
  HD_DATABASE_NAME: 'hd_release_' + 'b'.repeat(16), EXTERNAL_SYNC_MODE: 'off', TRANSLATION_PROVIDER: 'disabled'};

test('worker binds the current database on private postgres with escaped secret', () => {
  const env = workerEnvironment(approved, 'synthetic:@/?%pass', 15001);
  const url = new URL(env.DATABASE_URL);
  assert.equal(url.hostname, 'postgres');
  assert.equal(url.port, '5432');
  assert.equal(url.pathname, '/' + approved.HD_DATABASE_NAME);
  assert.equal(decodeURIComponent(url.password), 'synthetic:@/?%pass');
  assert.equal(url.username, approved.HD_DATABASE_NAME + '_app');
  assert.equal(approved.DATABASE_URL, undefined);
});

test('root and caller-provided database URLs cannot bypass the deployment binding', () => {
  assert.throws(() => workerEnvironment(approved, 'synthetic', 0));
  for (const name of ['DATABASE_URL', 'DATABASE_URL_FILE']) {
    assert.throws(() => workerEnvironment({...approved, [name]: 'override'}, 'synthetic', 15001));
  }
});

test('worker cannot activate continuous sync or translation', () => {
  for (const override of [{EXTERNAL_SYNC_MODE: 'on'}, {TRANSLATION_PROVIDER: 'aliyun'}, {TRANSLATION_PROVIDER: undefined}]) {
    assert.throws(() => workerEnvironment({...approved, ...override}, 'synthetic', 15001));
  }
});

test('missing/old/invalid deployment identity and malformed secrets are refused', () => {
  for (const override of [{HD_RELEASE_ID: 'latest'}, {HD_DEPLOYMENT_ENV: 'test'}, {HD_DATABASE_NAME: 'hd_auto'},
    {HD_DATABASE_NAME: undefined}, {HD_DATABASE_NAME: 'postgres'}, {HD_DATABASE_NAME: 'hd_release_a; DROP'}]) {
    assert.throws(() => workerEnvironment({...approved, ...override}, 'synthetic', 15001));
  }
  for (const password of ['', 'synthetic\n', 'synthetic\0']) {
    assert.throws(() => workerEnvironment(approved, password, 15001));
  }
});

test('FX is a separate exact operation; ingestion cannot inherit a network refresh gate', () => {
  assert.deepEqual(workerInvocation(['fx-refresh']), {argv: ['dist/external/fx-cli.js', '--formal-refresh'], formalFx: true});
  assert.deepEqual(workerInvocation(['fx-health']), {argv: ['dist/external/fx-cli.js', '--formal-health'], formalFx: true});
  assert.throws(() => workerInvocation(['fx-refresh', '--seed', 'a']));
  assert.throws(() => workerInvocation(['dist/main.js']));
  assert.throws(() => workerInvocation([]));
  assert.equal(workerInvocation(['once', '--job', 'synthetic-id']).formalFx, false);
  const env = workerEnvironment({...approved, EXTERNAL_FX_NETWORK: 'enabled', EXTERNAL_FX_FORMAL_DATABASE: 'other'}, 'synthetic', 15001);
  assert.equal(env.EXTERNAL_FX_NETWORK, undefined);
  assert.equal(env.EXTERNAL_FX_FORMAL_DATABASE, undefined);
});
