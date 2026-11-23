import type { PublicMedia } from '@hd/contracts/public';

const storageKey = 'hd-auto:external-photo-failures:v1';
const maxReports = 128;
const reportTtlMs = 10 * 60 * 1000;
const reported = new Map<string, number>();

function isRecent(at: unknown, now: number): at is number {
  return typeof at === 'number' && Number.isSafeInteger(at) && at <= now && now - at < reportTtlMs;
}

function readSessionReports(now: number): Map<string, number> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw || raw.length > 20_000) return new Map();
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return new Map();
    return new Map(entries.slice(-maxReports).filter((entry): entry is [string, number] =>
      Array.isArray(entry) && entry.length === 2 &&
      typeof entry[0] === 'string' && entry[0].length <= 120 && isRecent(entry[1], now)));
  } catch {
    return new Map();
  }
}

/** A local placeholder renders immediately. The worker signal is advisory and never retried here. */
export function reportExternalPhotoFailure(image: Pick<PublicMedia, 'id' | 'remote'>) {
  if (!image.remote) return;
  const { revision } = image.remote;
  const key = `${image.id}:${revision}`;
  const now = Date.now();
  if (isRecent(reported.get(key), now)) return;

  // Catalog cards open a new document to read live detail. Both documents share this tab's attempts.
  const sessionReports = readSessionReports(now);
  const prior = sessionReports.get(key);
  reported.delete(key);
  reported.set(key, prior ?? now);
  if (reported.size > maxReports) {
    const oldest = reported.keys().next().value;
    if (oldest !== undefined) reported.delete(oldest);
  }
  if (prior !== undefined) return;

  sessionReports.set(key, now);
  try {
    sessionStorage.setItem(storageKey, JSON.stringify([...sessionReports].slice(-maxReports)));
  } catch {
    // Document memory still deduplicates when Web Storage is blocked.
  }
  void fetch(`/api/v1/external-media/${encodeURIComponent(image.id)}/failure/`, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision }),
    signal: AbortSignal.timeout(5000),
  })
    .then((response) => response.body?.cancel())
    .catch(() => undefined);
}
