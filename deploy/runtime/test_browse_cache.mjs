import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowseCache } from './production/browse-cache.mjs';

const first = 'a'.repeat(32);
const second = 'b'.repeat(32);

function fixture(limits = {}) {
  const state = { generation: first, wall: 1_900_000_000_000, elapsed: 0 };
  const cache = createBrowseCache({
    readGeneration: () => state.generation,
    now: () => state.wall,
    tick: () => state.elapsed,
    ...limits,
  });
  function move(ms) {
    state.wall += ms;
    state.elapsed += ms;
  }
  const value = (text = 'anonymous', fields = {}) => ({
    body: Buffer.from(text),
    observedAt: state.wall,
    expiresAt: state.wall + 600_000,
    ...fields,
  });
  return { cache, move, state, value };
}

test('warm reads avoid the origin and do not extend the original age', async () => {
  const { cache, move, state, value } = fixture();
  const original = value();
  const request = 'document:/ru/cars/?page=2';
  let loads = 0;
  const load = () => (++loads, original);
  assert.deepEqual(await cache.read(request, load), { value: original, hit: false });
  move(305_000);
  assert.equal((await cache.read(request, load)).hit, true);
  move(292_000);
  assert.equal((await cache.read(request, load)).hit, true);
  assert.equal(loads, 1);
  // A wall-clock correction must not extend the entry either.
  state.wall -= 30_000;
  state.elapsed += 3_000;
  assert.equal((await cache.read(request, () => value())).hit, false);
});

test('an already-aged input and an earlier dependency deadline bind the document', async () => {
  const { cache, move, state, value } = fixture();
  const aged = value('data already five minutes old', {
    observedAt: state.wall - 300_000, expiresAt: state.wall + 600_000,
  });
  const short = value('signed image', { expiresAt: state.wall + 12_000 });
  assert.ok(await cache.read('aged', () => aged));
  assert.ok(await cache.read('short', () => short));
  move(12_000);
  assert.equal(await cache.read('short', () => short), null);
  assert.equal((await cache.read('aged', () => aged)).hit, true);
  move(288_000);
  assert.equal(await cache.read('aged', () => aged), null);
});

test('duplicate keys share one bounded in-flight origin request', async () => {
  const { cache, value } = fixture({ maxFills: 1, maxQueuedFills: 0 });
  const origin = Promise.withResolvers();
  let loads = 0;
  const load = generation => {
    assert.equal(generation, first);
    loads++;
    return origin.promise;
  };
  const requests = Array.from({ length: 20 }, () => cache.read('data:/vehicles?locale=zh&page=2', load));
  assert.deepEqual(await cache.read('data:/vehicles?locale=ru&page=2', load), { unavailable: true });
  origin.resolve(value());
  assert.equal((await Promise.all(requests)).filter(result => result?.hit === false).length, 20);
  assert.equal(loads, 1);
  assert.equal((await cache.read('data:/vehicles?locale=zh&page=2', load)).hit, true);
});

test('clearing a generation denies old hits and old in-flight delivery', async () => {
  const { cache, state, value } = fixture();
  const original = value('shows a vehicle');
  await cache.read('document:/en/', () => original);
  const origin = Promise.withResolvers();
  const pending = cache.read('document:/zh/', () => origin.promise);

  state.generation = null;
  assert.equal(await cache.read('document:/en/', () => assert.fail('cache disabled')), null);
  state.generation = second;
  const next = value('vehicle has been withdrawn');
  assert.deepEqual(await cache.read('document:/zh/', () => next), { value: next, hit: false });
  origin.resolve(original);
  assert.equal(await pending, null);
  assert.deepEqual(await cache.read('document:/zh/', () => assert.fail()), { value: next, hit: true });
});

test('an unreadable generation drops cached bytes even when it comes back unchanged', async () => {
  let readFails = false;
  const { cache, value } = fixture({ readGeneration: () => {
    if (readFails) throw new Error('fence unavailable');
    return first;
  } });
  await cache.read('page', () => value());
  readFails = true;
  assert.equal(await cache.read('page', () => assert.fail()), null);
  readFails = false;
  assert.equal((await cache.read('page', () => value())).hit, false);
});

test('bounds total bytes and keeps distinct representation, locale, query and page keys', async () => {
  const { cache, value } = fixture({ maxBytes: 16, maxEntryBytes: 8, maxEntries: 3 });
  const load = () => value('12345678');
  const doc = 'document:/en/cars/?page=2';
  const api = 'data:/vehicles?locale=en&page=2';
  const otherPage = 'document:/en/cars/?page=3';
  const otherLocale = 'document:/ru/cars/?page=2';
  await cache.read(doc, load);
  await cache.read(api, load);
  assert.equal((await cache.read(doc, load)).hit, true);
  assert.equal((await cache.read(otherPage, load)).hit, false);
  assert.equal((await cache.read(otherLocale, load)).hit, false);
  assert.equal((await cache.read(api, load)).hit, false);
  assert.equal(await cache.read(doc, () => value('123456789')), null);
});

test('misses with missing or invalid proof never become hits', async () => {
  const { cache, state, value } = fixture();
  for (const invalid of [
    undefined, { body: Buffer.from('no deadline') },
    value('future', { observedAt: state.wall + 1 }),
    value('expired', { expiresAt: state.wall }),
  ]) assert.equal(await cache.read('invalid', () => invalid), null);
  assert.throws(() => createBrowseCache({ readGeneration: () => first, maxEntries: 0 }), TypeError);
});

test('an authority read started before a visible withdrawal cannot restore the retired generation', async () => {
  const { cache, value } = fixture();
  const older = 'c'.repeat(64);
  const newer = 'd'.repeat(64);
  const oldPage = value('old published vehicle');
  const newPage = value('withdrawn vehicle omitted');
  const key = 'document:/en/';
  await cache.read(key, () => oldPage, () => older);
  const slow = Promise.withResolvers();
  const delayed = cache.read(key, () => assert.fail('stale reader must not fill'), () => slow.promise);
  const current = await cache.read(key, () => newPage, () => newer);
  slow.resolve(older);
  assert.equal(await delayed, null);
  assert.deepEqual(current, { value: newPage, hit: false });
  assert.deepEqual(await cache.read(key, () => assert.fail(), () => newer), { value: newPage, hit: true });
});

test('a cold fill must finish inside the same database authority as it started', async () => {
  const { cache, value } = fixture();
  let authority = 'c'.repeat(64);
  const fromSource = Promise.withResolvers();
  const starting = Promise.withResolvers();
  const pending = cache.read('document:/zh/', () => {
    starting.resolve();
    return fromSource.promise;
  }, () => authority);
  await starting.promise;
  authority = 'd'.repeat(64);
  fromSource.resolve(value('renders before archive'));
  assert.equal(await pending, null);
  const fresh = value('renders after archive');
  assert.deepEqual(await cache.read('document:/zh/', () => fresh, () => authority), { value: fresh, hit: false });
});

test('a newer authority accepted between proof resolution and insertion wins', async () => {
  const { cache, value } = fixture();
  const older = 'c'.repeat(64);
  const newer = 'd'.repeat(64);
  const lastCheckStarted = Promise.withResolvers();
  const lastCheck = Promise.withResolvers();
  const freshCheck = Promise.withResolvers();
  const key = 'document:/ru/';
  let oldReads = 0;
  let newReads = 0;
  const oldFill = cache.read(key, () => value('older card'), () => {
    if (++oldReads === 1) return older;
    lastCheckStarted.resolve();
    return lastCheck.promise;
  });
  await lastCheckStarted.promise;
  const fresh = value('withdrawn vehicle omitted');
  const newFill = cache.read(key, () => fresh, () => ++newReads === 1 ? freshCheck.promise : newer);
  lastCheck.resolve(older);
  freshCheck.resolve(newer);
  assert.equal(await oldFill, null);
  assert.deepEqual(await newFill, { value: fresh, hit: false });
});
