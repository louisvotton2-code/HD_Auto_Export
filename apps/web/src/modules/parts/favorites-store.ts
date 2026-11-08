export const partFavoritesStorageKey = 'hd-auto:part-favorites:v1';
const empty: readonly string[] = Object.freeze([]);
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9]{1,60}$/.test(id);

/** Browser preference only: persist identities, never prices, stock or complete product snapshots. */
export function createPartFavoritesStore(storage: () => Storage, knownIds: readonly string[] = [], external?: (refresh: () => void) => () => void) {
  let ids = empty, unavailable = false, detach: (() => void) | undefined;
  let known = new Set(knownIds.filter(validId));
  const listeners = new Set<() => void>();
  function replace(next: readonly string[]) {
    if (JSON.stringify(ids) === JSON.stringify(next)) return;
    ids = next.length ? next : empty; listeners.forEach((listener) => listener());
  }
  function refresh() {
    if (unavailable) return;
    let raw: string | null;
    try { raw = storage().getItem(partFavoritesStorageKey); } catch { unavailable = true; return; }
    try {
      const data: unknown = raw ? JSON.parse(raw) : null;
      const values = data && typeof data === 'object' && 'version' in data && data.version === 1 && 'ids' in data && Array.isArray(data.ids) ? data.ids : [];
      replace([...new Set(values.filter((id): id is string => validId(id) && known.has(id)))].slice(0, 100));
    } catch { replace(empty); }
  }
  return {
    getSnapshot: () => ids,
    getServerSnapshot: () => empty,
    refresh,
    configureKnownIds(values: readonly string[]) {
      known = new Set(values.filter(validId));
      replace(ids.filter((id) => known.has(id))); refresh();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) { detach = external?.(refresh); refresh(); }
      return () => { listeners.delete(listener); if (!listeners.size) { detach?.(); detach = undefined; } };
    },
    toggle(id: string) {
      if (!validId(id) || !known.has(id)) return;
      refresh();
      const next = ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id].slice(-100);
      try { if (!unavailable) storage().setItem(partFavoritesStorageKey, JSON.stringify({ version: 1, ids: next })); } catch { unavailable = true; }
      replace(next);
    },
  };
}

export const partFavoritesStore = createPartFavoritesStore(() => window.localStorage, [], (refresh) => {
  const changed = (event: StorageEvent) => { if (event.key === null || event.key === partFavoritesStorageKey) refresh(); };
  window.addEventListener('storage', changed);
  return () => window.removeEventListener('storage', changed);
});
