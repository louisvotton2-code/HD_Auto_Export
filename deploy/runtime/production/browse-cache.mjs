// The HTTP adapter decides which responses are anonymous and holds the trusted
// origin proof. This store enforces its lifetime and the local withdrawal fence.
const lifetime = 600_000;
const generationPattern = /^[a-f0-9]{32}$/u;
const authorityPattern = /^[a-f0-9]{64}$/u;
const maxRetiredAuthorities = 256;

export function createBrowseCache({
  readGeneration,
  now = Date.now,
  tick = () => performance.now(),
  maxEntries = 96,
  maxBytes = 16 * 1024 * 1024,
  maxEntryBytes = 512 * 1024,
  maxFills = 12,
  maxQueuedFills = 8,
}) {
  if (typeof readGeneration !== 'function' || [maxEntries, maxBytes, maxEntryBytes, maxFills]
    .some(value => !Number.isSafeInteger(value) || value < 1) ||
    !Number.isSafeInteger(maxQueuedFills) || maxQueuedFills < 0) throw new TypeError('Invalid browse cache limits');
  const entries = new Map();
  const fills = new Map();
  const waiting = [];
  let active;
  let sequence = 0;
  let usedBytes = 0;
  let runningFills = 0;

  function generation() {
    let value;
    try { value = readGeneration(); } catch { /* An unreadable fence disables reuse. */ }
    const id = typeof value === 'string' && generationPattern.test(value) ? value : null;
    if (active?.id !== id) {
      active = { id, sequence: ++sequence, issued: 0, boundary: 0, authority: null, retired: new Set() };
      entries.clear();
      usedBytes = 0;
    }
    return active;
  }

  function discard(key) {
    const previous = entries.get(key);
    if (!previous) return;
    entries.delete(key);
    usedBytes -= previous.value.body.length;
  }

  function current(entry) {
    return now() < entry.wallDeadline && tick() < entry.elapsedDeadline;
  }

  async function verifyAuthority(fence, readAuthority) {
    if (!readAuthority) return fence;
    const probe = ++fence.issued;
    let value;
    try { value = await readAuthority(); } catch { return null; }
    if (generation() !== fence || fence.retired.size >= maxRetiredAuthorities) return null;
    if (value?.retryAfter) return value;
    if (typeof value !== 'string' || !authorityPattern.test(value) || fence.retired.has(value)) return null;
    if (fence.authority?.value === value) return fence.authority;
    // A request already on the wire when an authority was accepted cannot
    // replace it. PostgreSQL may start its statement before or after our peer.
    if (fence.authority && probe <= fence.boundary) return null;
    if (fence.authority) fence.retired.add(fence.authority.value);
    fence.authority = { value };
    fence.boundary = fence.issued;
    entries.clear();
    usedBytes = 0;
    return fence.authority;
  }

  function acquireFill() {
    if (runningFills < maxFills) {
      runningFills++;
      return Promise.resolve();
    }
    return new Promise(resolve => waiting.push(resolve));
  }

  function releaseFill() {
    const next = waiting.shift();
    if (next) next();
    else runningFills--;
  }

  function insert(key, fence, startedWall, startedTick, value) {
    if (generation() !== fence || !value || !Buffer.isBuffer(value.body) ||
        value.body.length === 0 || value.body.length > Math.min(maxEntryBytes, maxBytes)) return null;
    const { observedAt, expiresAt } = value;
    const wallNow = now();
    if (!Number.isSafeInteger(observedAt) || !Number.isSafeInteger(expiresAt) ||
        observedAt <= 0 || observedAt > wallNow) return null;
    const wallDeadline = Math.min(observedAt + lifetime, expiresAt, startedWall + lifetime);
    const elapsedDeadline = Math.min(startedTick + wallDeadline - startedWall, tick() + wallDeadline - wallNow);
    const entry = { value, wallDeadline, elapsedDeadline };
    if (!current(entry)) return null;

    discard(key);
    while (entries.size >= maxEntries || usedBytes + value.body.length > maxBytes) {
      discard(entries.keys().next().value);
    }
    entries.set(key, entry);
    usedBytes += value.body.length;
    return entry;
  }

  async function read(key, load, readAuthority) {
    const fence = generation();
    if (!fence.id || typeof key !== 'string' || key.length === 0 || key.length > 2048) return null;
    const authority = await verifyAuthority(fence, readAuthority);
    if (!authority || authority.retryAfter) return authority;
    const valid = () => generation() === fence && (!readAuthority || fence.authority === authority);
    if (!valid()) return null;
    const stored = entries.get(key);
    if (stored && current(stored)) {
      entries.delete(key);
      entries.set(key, stored);
      return { value: stored.value, hit: true };
    }
    discard(key);

    // Old fills still count toward the cap during an emergency. They cannot
    // publish into the new generation or answer requests that joined them.
    const fillKey = fence.sequence + ':' + (authority.value ?? '') + ':' + key;
    let inFlight = fills.get(fillKey);
    if (!inFlight) {
      if (fills.size >= maxFills + maxQueuedFills) return { unavailable: true };
      const startedWall = now();
      const startedTick = tick();
      inFlight = acquireFill()
        .then(() => valid() ? load(fence.id) : null)
        .then(async value => {
          if (value?.retryAfter) return { retryAfter: value.retryAfter };
          if (!value || !valid()) return null;
          if (readAuthority) {
            const after = await verifyAuthority(fence, readAuthority);
            if (after?.retryAfter) return after;
            if (after !== authority || !valid()) return null;
          }
          return insert(key, fence, startedWall, startedTick, value);
        })
        .catch(() => null)
        .finally(() => {
          fills.delete(fillKey);
          releaseFill();
        });
      fills.set(fillKey, inFlight);
    }
    const result = await inFlight;
    if (!valid() || !result) return null;
    if (result.retryAfter) return result;
    if (!current(result)) return null;
    return { value: result.value, hit: false };
  }

  return { read };
}
