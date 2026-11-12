import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Node 20 cannot import TS directly. Compile only the dependency-free pacing helper in memory.
const source = await readFile(new URL('./live-rate-window.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const helperExports = {};
runInNewContext(compiled, { exports: helperExports }, { filename: 'live-rate-window.ts', timeout: 1000 });
const { rateLimitSeconds, extendRateDeadline, rateCooldownMs } = helperExports;

test('accepts only bounded relative seconds, not dates or an unbounded server value', () => {
  assert.equal(rateLimitSeconds('1'), 1);
  assert.equal(rateLimitSeconds('60'), 60);
  assert.equal(rateLimitSeconds(' 28 '), 28);
  for (const value of [undefined, '', '0', '61', '-1', '1.5', '01', '1e1', 'NaN', '1794463317', 'Thu, 12 Nov 2026 06:00:00 GMT']) {
    assert.equal(rateLimitSeconds(value), null, String(value));
  }
});

test('later observations cannot shorten a previously observed reset deadline', () => {
  const initial = extendRateDeadline(0, { 'x-ratelimit-reset': '60' }, 1000);
  assert.equal(initial, 61_000);
  assert.equal(extendRateDeadline(initial, { 'retry-after': '1' }, 2000), initial);
  assert.equal(extendRateDeadline(initial, { 'x-ratelimit-reset': '61' }, 5000), initial);
  assert.equal(extendRateDeadline(initial, { 'x-ratelimit-reset': '20', 'retry-after': '60' }, 5000), 65_000);
});

test('waits only the remaining server window and bounds clock rollback', () => {
  assert.equal(rateCooldownMs(61_000, 1000), 60_100);
  assert.equal(rateCooldownMs(61_000, 60_900), 200);
  assert.equal(rateCooldownMs(61_000, 61_000), 0);
  assert.equal(rateCooldownMs(61_000, 70_000), 0);
  assert.equal(rateCooldownMs(61_000, -100_000), 61_000);
});
