import assert from 'node:assert/strict';
import test from 'node:test';
import {checkWorkerMode, workerEnvironment, workerInvocation} from './production/worker-entrypoint.mjs';

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

test('worker cannot activate legacy synthetic sync or translation', () => {
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

test('formal full sync has an explicit CLI and cannot select another program', () => {
  for (const command of ['configure', 'run', 'serve', 'status', 'control', 'archive-pin', 'archive-release']) {
    assert.deepEqual(workerInvocation(['full-sync', command]), {
      argv: ['dist/external/full-sync/cli.js', command], formalFx: false, fullSync: true,
    });
  }
  for (const args of [['full-sync'], ['full-sync', 'dist/main.js'], ['full-sync', '--seed']]) {
    assert.throws(() => workerInvocation(args));
  }
});

test('one-shot replay accepts only the fixed plan and the exact argument shape', () => {
  const plan = '/private/replay/plan.json', id = '781af2ee-24b6-4b2f-8613-556805f53a16';
  for (const args of [['replay-check', '--plan', plan], ['replay-prepare', '--actor', 'ExistingStaff-01', '--plan', plan],
    ['replay-status', '--replay-id', id]]) {
    const operation = workerInvocation(['full-sync', ...args]);
    assert.deepEqual(operation, {argv: ['dist/external/full-sync/cli.js', ...args], formalFx: false, fullSync: false, replay: true});
    assert.doesNotThrow(() => checkWorkerMode({HD_FULL_REPLAY_OPS: 'true'}, operation));
    assert.throws(() => checkWorkerMode({}, operation));
    assert.throws(() => checkWorkerMode({HD_FULL_REPLAY_OPS: 'true', CHINACARAPI_KEY_FILE: '/run/secrets/provider'}, operation));
    assert.throws(() => checkWorkerMode({HD_FULL_REPLAY_OPS: 'true', FULL_SYNC_ARCHIVE_ROOT: '/private/full-sync'}, operation));
  }
  for (const args of [['replay-check', '--plan', '/tmp/other'], ['replay-check', '--plan', plan, '--plan', plan],
    ['replay-prepare', '--plan', plan], ['replay-prepare', '--actor', '--force', '--plan', plan],
    ['replay-status', '--replay-id', 'not-a-uuid'], ['replay-status', '--replay-id', id, '--force']]) {
    assert.throws(() => workerInvocation(['full-sync', ...args]));
  }
  for (const args of [['full-sync', 'serve'], ['backup-lease', 'release', '--reference', 'backup:a'], ['fx-refresh']]) {
    assert.throws(() => checkWorkerMode({HD_FULL_REPLAY_OPS: 'true', FULL_SYNC_ARCHIVE_ROOT: '/private/full-sync'}, workerInvocation(args)));
  }
  assert.doesNotThrow(() => checkWorkerMode({FULL_SYNC_ARCHIVE_ROOT: '/private/full-sync'}, workerInvocation(['full-sync', 'serve'])));
});


test('backup lease uses only the database CLI without media scanning', () => {
  assert.deepEqual(workerInvocation(['backup-lease', 'acquire', '--reference', 'backup:ext09:daily-20261114']), {argv: ['dist/backup-lease-cli.js', 'acquire', '--reference', 'backup:ext09:daily-20261114'], formalFx: false, fullSync: false});
  for (const args of [['backup-lease'], ['backup-lease', 'serve', '--reference', 'backup:a'], ['backup-lease', 'release', '--reference', 'not-a-backup'], ['backup-lease', 'acquire', '--reference', 'backup:a', '--force']]) assert.throws(() => workerInvocation(args));
});
