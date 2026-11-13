import test from 'node:test';
import assert from 'node:assert/strict';
import { traceCase, traceMode } from './trace-live-guard.mjs';

const env = { ADMIN_LIVE_TRACE: 'synthetic-only', API_TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:55439/postgres', ADMIN_WEB_TARGET: 'http://127.0.0.1:3323' };
const args = ['--grep', traceCase];
test('trace mode accepts only the explicit single local disabled-provider case', () => assert.equal(traceMode(env, args, 'disabled'), true));
test('trace absence leaves old modes to their existing guards', () => assert.equal(traceMode({}, [], 'aliyun'), false));
test('trace rejects paid/local translators, old external mode and arbitrary origins', () => {
  for (const provider of ['aliyun', 'libretranslate']) assert.throws(() => traceMode(env, args, provider));
  for (const extra of [{ ADMIN_LIVE_TRACE: 'yes' }, { ADMIN_LIVE_EXTERNAL: 'synthetic-only' }, { ADMIN_LIVE_ORIGIN: 'http://127.0.0.1:3363' }]) assert.throws(() => traceMode({ ...env, ...extra }, args, 'disabled'));
});
test('trace rejects broad selection, repeat flags and missing explicit infrastructure', () => {
  for (const selection of [[], ['--grep', 'real'], [...args, '--repeat-each=2']]) assert.throws(() => traceMode(env, selection, 'disabled'));
  for (const key of ['API_TEST_DATABASE_URL', 'ADMIN_WEB_TARGET']) assert.throws(() => traceMode({ ...env, [key]: '' }, args, 'disabled'));
});
test('trace rejects remote/business DB names and socket URL options', () => {
  for (const database of ['postgresql://127.0.0.1/business', 'postgresql://example.invalid/postgres', 'postgresql://127.0.0.1/postgres?host=/tmp', 'https://127.0.0.1/postgres']) assert.throws(() => traceMode({ ...env, API_TEST_DATABASE_URL: database }, args, 'disabled'));
});
test('trace rejects the existing site, API/admin ports and unsafe FE endpoints', () => {
  for (const web of ['http://127.0.0.1:3363', 'http://127.0.0.1:3319', 'http://127.0.0.1:3322', 'https://example.invalid', 'http://127.0.0.1:3323/path', 'http://127.0.0.1:3323/?next=1', 'http://user:pass@127.0.0.1:3323']) assert.throws(() => traceMode({ ...env, ADMIN_WEB_TARGET: web }, args, 'disabled'));
});
