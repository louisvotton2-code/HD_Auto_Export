import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageKey = 'hd-auto:external-photo-failures:v1';
const refreshedAt = '2026-11-23T12:00:00.000Z';
const photo = (revision = 1, number = 1) => ({
  id: `ximg-00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  remote: { revision, refreshedAt, expiresAt: null },
});
const fetcher = vi.fn();
const storage = new Map<string, string>();

/** Page navigation resets module state, but the tab's Web Storage survives. */
async function newDocument() {
  vi.resetModules();
  return (await import('./report-external-photo-failure')).reportExternalPhotoFailure;
}

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  fetcher.mockReset().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('external photo failure reporting', () => {
  it('deduplicates an attempt across documents while allowing a new revision', async () => {
    const catalogFailure = await newDocument();
    catalogFailure(photo());
    const detailFailure = await newDocument();
    detailFailure(photo());
    detailFailure(photo(2));
    detailFailure(photo(2));
    detailFailure({ id: 'owner-photo' });

    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([{ revision: 1 }, { revision: 2 }]);
    expect(fetcher.mock.calls[0]).toMatchObject([
      `/api/v1/external-media/${photo().id}/failure/`,
      { method: 'POST', credentials: 'omit', keepalive: true, redirect: 'error' },
    ]);
  });

  it('does not retry and uses document memory if either storage operation throws', async () => {
    const blocked = vi.fn(() => { throw new Error('Storage blocked'); });
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked });
    fetcher.mockRejectedValue(new Error('Offline'));
    const report = await newDocument();
    report(photo());
    report(photo());
    report(photo(2));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('caps the ledger and expires attempts without extending them on a repeated failure', async () => {
    const now = Date.parse(refreshedAt);
    const time = vi.spyOn(Date, 'now').mockReturnValue(now);
    const report = await newDocument();
    for (let number = 1; number <= 130; number++) report(photo(1, number));
    expect(JSON.parse(storage.get(storageKey)!)).toHaveLength(128);

    const detailFailure = await newDocument();
    time.mockReturnValue(now + 599_999);
    detailFailure(photo(1, 130));
    expect(fetcher).toHaveBeenCalledTimes(130);
    time.mockReturnValue(now + 600_000);
    detailFailure(photo(1, 130));
    expect(fetcher).toHaveBeenCalledTimes(131);
    expect(JSON.parse(storage.get(storageKey)!)).toHaveLength(1);
  });
});
