// The HTTP adapter decides which responses are anonymous and holds the trusted
// origin proof. This store enforces its lifetime and the local withdrawal fence.
const lifetime = 600_000;
const generationPattern = /^[a-f0-9]{32}$/u;

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
      active = { id, sequence: ++sequence };
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

  async function read(key, load) {
    const fence = generation();
    if (!fence.id || typeof key !== 'string' || key.length === 0 || key.length > 2048) return null;
    const stored = entries.get(key);
    if (stored && current(stored)) {
      entries.delete(key);
      entries.set(key, stored);
      return { value: stored.value, hit: true };
    }
    discard(key);

    // Old fills still count toward the cap during an emergency. They cannot
    // publish into the new generation or answer requests that joined them.
    const fillKey = fence.sequence + ':' + key;
    let inFlight = fills.get(fillKey);
    if (!inFlight) {
      if (fills.size >= maxFills + maxQueuedFills) return { unavailable: true };
      const startedWall = now();
      const startedTick = tick();
      inFlight = acquireFill()
        .then(() => generation() === fence ? load(fence.id) : null)
        .then(value => value?.retryAfter ? { retryAfter: value.retryAfter }
          : insert(key, fence, startedWall, startedTick, value))
        .catch(() => null)
        .finally(() => {
          fills.delete(fillKey);
          releaseFill();
        });
      fills.set(fillKey, inFlight);
    }
    const result = await inFlight;
    if (generation() !== fence || !result) return null;
    if (result.retryAfter) return result;
    if (!current(result)) return null;
    return { value: result.value, hit: false };
  }

  return { read };
}
