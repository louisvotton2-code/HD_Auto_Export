import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { salesAccess } from './access.js';

const current = 'a'.repeat(64);
const previous = 'b'.repeat(64);
const request = (authorization?: string) => ({ headers: { authorization } }) as FastifyRequest;
const response = () => {
  const headers = new Map<string, string>();
  return { headers, reply: { header: (name: string, value: string) => headers.set(name, value) } as unknown as FastifyReply };
};

test('sales authentication fails closed, permits a rotation token and shares a bounded budget', () => {
  let now = 0;
  const access = salesAccess([current, previous], () => now);
  const { reply, headers } = response();
  assert.throws(() => salesAccess([]).authenticate(request(`Bearer ${current}`), reply), { status: 404 });
  assert.throws(() => access.authenticate(request(), reply), { status: 401 });
  assert.equal(headers.get('WWW-Authenticate'), 'Bearer');
  assert.throws(() => access.authenticate(request('Bearer wrong'), reply), { status: 401 });
  assert.throws(() => access.authenticate(request(`Bearer ${'c'.repeat(64)}`), reply), { status: 401 });
  for (let i = 0; i < 60; i++) access.authenticate(request(`Bearer ${i % 2 ? current : previous}`), reply);
  assert.throws(() => access.authenticate(request(`Bearer ${previous}`), reply), { status: 429 });
  assert.equal(headers.get('Retry-After'), '60');
  now = 60_000;
  assert.doesNotThrow(() => access.authenticate(request(`Bearer ${current}`), reply));
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('twenty authorized sales reads finish in arrival order with at most two active reads', async () => {
  const access = salesAccess([current]);
  const gate = deferred();
  const order = Array.from({ length: 20 }, (_, index) => index);
  const entered: number[] = [];
  let active = 0;
  let peak = 0;
  const reads = order.map(index => {
    const { reply } = response();
    access.authenticate(request(`Bearer ${current}`), reply);
    return access.read(reply, async () => {
      entered.push(index);
      peak = Math.max(peak, ++active);
      await gate.promise;
      active--;
      return index;
    });
  });
  assert.deepEqual(entered, [0, 1]);
  gate.resolve();
  assert.deepEqual(await Promise.all(reads), order);
  assert.deepEqual(entered, order);
  assert.equal(peak, 2);
});

test('sales queue admits 24 waiting reads and rejects overflow immediately', async () => {
  const access = salesAccess([current]);
  const gate = deferred();
  const reads = Array.from({ length: 26 }, () => access.read(response().reply, () => gate.promise));
  const { reply, headers } = response();
  await assert.rejects(access.read(reply, async () => assert.fail('Overflow read must not run')), {
    status: 429, retryable: true, message: 'Sales service queue is full.',
  });
  assert.equal(headers.get('Retry-After'), '1');
  gate.resolve();
  await Promise.all(reads);
});

test('sales wait timers do not start a database read after expiry', async () => {
  const access = salesAccess([current], undefined, 10);
  const gate = deferred();
  const running = Array.from({ length: 2 }, () => access.read(response().reply, () => gate.promise));
  const { reply, headers } = response();
  await assert.rejects(access.read(reply, async () => assert.fail('Expired read must not run')), {
    status: 429, retryable: true, message: 'Sales service wait expired.',
  });
  assert.equal(headers.get('Retry-After'), '1');
  gate.resolve();
  await Promise.all(running);
  assert.equal(await access.read(response().reply, async () => 3), 3);
});

test('sales release skips requests past their deadline before timer callbacks and advances from a failing read', async () => {
  let now = 0;
  const access = salesAccess([current], () => now);
  const gate = deferred();
  const failure = deferred();
  const left = access.read(response().reply, () => gate.promise);
  const right = access.read(response().reply, () => failure.promise);
  const failedRead = assert.rejects(right, /fixture failure/);
  const expiredRead = assert.rejects(
    access.read(response().reply, async () => assert.fail('Expired read must not run')),
    { status: 429, retryable: true },
  );
  now = 2000;
  const next = access.read(response().reply, async () => 3);
  failure.reject(new Error('fixture failure'));
  await Promise.all([failedRead, expiredRead]);
  assert.equal(await next, 3);
  gate.resolve();
  await left;
});
