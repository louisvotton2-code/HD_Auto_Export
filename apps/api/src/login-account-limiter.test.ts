import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LoginAccountLimiter } from './login-account-limiter.js';

const secret = 'login-limiter-test-secret-only';

test('five attempts share the Better Auth account casing and reset at exact expiry', () => {
  let now = 100;
  const limiter = new LoginAccountLimiter(secret, { now: () => now });
  const emails = ['operator@example.invalid', 'Operator@Example.Invalid', 'OPERATOR@EXAMPLE.INVALID'];
  for (let i = 0; i < 5; i++) assert.equal(limiter.retryAfter(emails[i % emails.length]), null);
  assert.equal(limiter.retryAfter(emails[0]), 60);
  now = 59_101;
  assert.equal(limiter.retryAfter(emails[1]), 1);
  now = 60_099;
  assert.equal(limiter.retryAfter(emails[2]), 1);
  now = 60_100;
  assert.equal(limiter.retryAfter(emails[0]), null);
});

test('empty and nonstring values are ignored; nonempty malformed strings get independent budgets', () => {
  const limiter = new LoginAccountLimiter(secret, { now: () => 0, attempts: 1, maxNewAccounts: 3 });
  for (const value of [undefined, null, '', 0, false, [], {}, { toString: () => { throw new Error('not a string'); } }]) {
    assert.equal(limiter.retryAfter(value), null);
  }
  assert.equal(limiter.retryAfter('Operator@Example.Invalid '), null);
  assert.equal(limiter.retryAfter('operator@example.invalid'), null);
  assert.equal(limiter.retryAfter('not an email'), null);
  assert.equal(limiter.retryAfter('NOT AN EMAIL'), 60);
  assert.equal(limiter.retryAfter('operator@example.invalid'), 60);
});

test('the trailing window of new accounts does not evict or block existing buckets', () => {
  let now = 0;
  const limiter = new LoginAccountLimiter(secret, { now: () => now, attempts: 2, maxNewAccounts: 2 });
  assert.equal(limiter.retryAfter('first'), null);
  now = 5000;
  assert.equal(limiter.retryAfter('second'), null);
  assert.equal(limiter.retryAfter('third'), 55);
  assert.equal(limiter.retryAfter('FIRST'), null);
  assert.equal(limiter.retryAfter('first'), 55);
  now = 60_000;
  assert.equal(limiter.retryAfter('third'), null);
  assert.equal(limiter.retryAfter('fourth'), 5);
  assert.equal(limiter.retryAfter('second'), null);
  now = 65_000;
  assert.equal(limiter.retryAfter('fourth'), null);
});

test('hard storage capacity rejects rotation without growing or evicting a live account', () => {
  let now = 0;
  const limiter = new LoginAccountLimiter(secret, { now: () => now, attempts: 1, maxAccounts: 2, maxNewAccounts: 8 });
  assert.equal(limiter.retryAfter('first'), null);
  assert.equal(limiter.retryAfter('second'), null);
  for (let i = 0; i < 1000; i++) assert.equal(limiter.retryAfter('attempt-' + i), 60);
  assert.equal(limiter.retryAfter('first'), 60);
  assert.equal(limiter.retryAfter('second'), 60);
  now = 60_000;
  assert.equal(limiter.retryAfter('attempt-999'), null);
  assert.equal(limiter.retryAfter('attempt-998'), null);
  assert.equal(limiter.retryAfter('attempt-997'), 60);
});
