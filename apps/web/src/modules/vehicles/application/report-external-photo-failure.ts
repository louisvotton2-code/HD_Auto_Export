import type { PublicMedia } from '@hd/contracts/public';

const reported = new Set<string>();

/** A local placeholder renders immediately. The worker signal is advisory and never retried here. */
export function reportExternalPhotoFailure(image: Pick<PublicMedia, 'id' | 'remote'>) {
  if (!image.remote) return;
  const { revision } = image.remote;
  const key = `${image.id}:${revision}`;
  if (reported.has(key)) return;
  reported.add(key);
  if (reported.size > 128) {
    const oldest = reported.values().next().value;
    if (oldest) reported.delete(oldest);
  }
  void fetch(`/api/v1/external-media/${encodeURIComponent(image.id)}/failure/`, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision }),
    signal: AbortSignal.timeout(5000),
  })
    .then((response) => response.body?.cancel())
    .catch(() => undefined);
}
