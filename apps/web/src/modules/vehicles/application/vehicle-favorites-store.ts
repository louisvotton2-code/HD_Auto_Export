import {
  EMPTY_VEHICLE_FAVORITES,
  normalizeVehicleFavoriteIds,
  parseVehicleFavoriteIds,
  VEHICLE_FAVORITES_STORAGE_KEY,
} from './favorite-vehicle-ids';

type FavoriteStorage = Pick<Storage, 'getItem' | 'setItem'>;
type StorageChange = { key: string | null; newValue: string | null };
type FavoritesEnvironment = {
  isBrowser: () => boolean;
  storage: () => FavoriteStorage | null;
  subscribe: (listener: (event: StorageChange) => void) => () => void;
};

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
const browserEnvironment: FavoritesEnvironment = {
  isBrowser: () => typeof window !== 'undefined',
  storage: browserStorage,
  subscribe(listener) {
    const receive = (event: StorageEvent) => {
      try {
        if (event.storageArea && event.storageArea !== browserStorage()) return;
        listener(event);
      } catch {
        /* An unreadable storage event cannot break in-memory controls. */
      }
    };
    window.addEventListener('storage', receive);
    return () => window.removeEventListener('storage', receive);
  },
};

const sameIds = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

/** A small external store shared by all page instances. Browser storage is optional.
 * The factory provides isolated environments for failure/concurrency tests. */
export function createVehicleFavoritesStore(
  environment: FavoritesEnvironment = browserEnvironment,
) {
  let ids = EMPTY_VEHICLE_FAVORITES;
  let initialized = false;
  let memoryOnly = false;
  let unsubscribeStorage: (() => void) | undefined;
  const listeners = new Set<() => void>();

  function readStored(): readonly string[] | null {
    try {
      const storage = environment.storage();
      return storage
        ? parseVehicleFavoriteIds(storage.getItem(VEHICLE_FAVORITES_STORAGE_KEY))
        : null;
    } catch {
      return null;
    }
  }
  function initialize() {
    if (initialized || !environment.isBrowser()) return;
    initialized = true;
    const stored = readStored();
    if (stored !== null) ids = stored;
  }
  function replace(next: readonly string[]) {
    if (sameIds(ids, next)) return;
    ids = next;
    for (const listener of listeners) listener();
  }
  function receive(event: StorageChange) {
    if (event.key !== VEHICLE_FAVORITES_STORAGE_KEY && event.key !== null) return;
    const next = parseVehicleFavoriteIds(event.key === null ? null : event.newValue);
    // Invalid external storage must not destroy the last good in-memory selection.
    if (next === null) return;
    memoryOnly = false;
    replace(next);
  }
  function subscribe(listener: () => void) {
    if (!environment.isBrowser()) return () => {};
    initialize();
    listeners.add(listener);
    if (listeners.size === 1) {
      try {
        unsubscribeStorage = environment.subscribe(receive);
      } catch {
        /* Same-document changes still synchronize without browser storage events. */
      }
      if (!memoryOnly) {
        const latest = readStored();
        if (latest !== null) replace(latest);
      }
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        unsubscribeStorage?.();
        unsubscribeStorage = undefined;
      }
    };
  }
  function getSnapshot() {
    if (!environment.isBrowser()) return EMPTY_VEHICLE_FAVORITES;
    initialize();
    return ids;
  }
  function mutate(change: (current: readonly string[]) => readonly string[]) {
    if (!environment.isBrowser()) return;
    initialize();
    let current = ids;
    if (!memoryOnly) {
      const latest = readStored();
      if (latest !== null) current = latest;
      else memoryOnly = true;
    }
    const next = normalizeVehicleFavoriteIds(change(current));
    try {
      const storage = environment.storage();
      if (storage) {
        storage.setItem(VEHICLE_FAVORITES_STORAGE_KEY, JSON.stringify({ version: 1, ids: next }));
        memoryOnly = false;
      } else memoryOnly = true;
    } catch {
      memoryOnly = true;
    }
    // A failed write never loses local changes on the following toggle.
    replace(next);
  }
  function toggle(id: string) {
    if (!normalizeVehicleFavoriteIds([id]).length) return;
    mutate((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [id, ...current],
    );
  }
  function remove(id: string) {
    mutate((current) => current.filter((item) => item !== id));
  }
  function clear() {
    mutate(() => EMPTY_VEHICLE_FAVORITES);
  }
  return {
    subscribe,
    getSnapshot,
    getServerSnapshot: () => EMPTY_VEHICLE_FAVORITES,
    toggle,
    remove,
    clear,
  };
}

export const vehicleFavoritesStore = createVehicleFavoritesStore();
