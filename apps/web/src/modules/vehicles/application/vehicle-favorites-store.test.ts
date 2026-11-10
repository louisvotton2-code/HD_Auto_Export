import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_VEHICLE_FAVORITES,
  MAX_VEHICLE_FAVORITES,
  normalizeVehicleFavoriteIds,
  parseVehicleFavoriteIds,
  VEHICLE_FAVORITES_STORAGE_KEY as key,
} from './favorite-vehicle-ids';
import { createVehicleFavoritesStore } from './vehicle-favorites-store';

afterEach(() => vi.unstubAllGlobals());
const saved = (ids: string[]) => JSON.stringify({ version: 1, ids });
type Change = { key: string | null; newValue: string | null };

function environment(initial: string | null = null) {
  let raw = initial;
  const listeners = new Set<(event: Change) => void>();
  const storage = {
    getItem: vi.fn(() => raw),
    setItem: vi.fn((_key: string, value: string) => {
      raw = value;
    }),
  };
  return {
    storage,
    raw: () => raw,
    emit(event: Change) {
      if (event.key === key || event.key === null) raw = event.newValue;
      for (const listener of listeners) listener(event);
    },
    port: {
      isBrowser: () => true,
      storage: () => storage,
      subscribe(listener: (event: Change) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

describe('favorite identities and browser persistence', () => {
  it('retains unique contract IDs in order, excluding DTOs, URLs and unsupported storage versions', () => {
    expect(
      normalizeVehicleFavoriteIds([
        'car-2',
        'car-1',
        'car-2',
        '',
        0,
        {},
        '/car',
        'https://x',
        'a b',
      ]),
    ).toEqual(['car-2', 'car-1']);
    expect(normalizeVehicleFavoriteIds({ id: 'car-1', availability: 'available' })).toEqual([]);
    for (const raw of ['broken{', '[]', '{"version":2,"ids":["car-1"]}', '{"version":1}'])
      expect(parseVehicleFavoriteIds(raw)).toBeNull();
    expect(parseVehicleFavoriteIds(null)).toBe(EMPTY_VEHICLE_FAVORITES);
  });

  it('bounds storage data and keeps the newest addition when a full selection is toggled', () => {
    const ids = Array.from({ length: MAX_VEHICLE_FAVORITES + 5 }, (_, i) => `car-${i}`);
    expect(normalizeVehicleFavoriteIds(ids)).toEqual(ids.slice(0, MAX_VEHICLE_FAVORITES));
    const env = environment(saved(ids));
    const store = createVehicleFavoritesStore(env.port);
    expect(store.getSnapshot()).toHaveLength(MAX_VEHICLE_FAVORITES);
    store.toggle('newest');
    expect(store.getSnapshot()).toEqual(['newest', ...ids.slice(0, MAX_VEHICLE_FAVORITES - 1)]);
    expect(JSON.parse(env.raw()!).ids).toHaveLength(MAX_VEHICLE_FAVORITES);
    store.toggle('newest');
    expect(store.getSnapshot()).toHaveLength(MAX_VEHICLE_FAVORITES - 1);
  });

  it('persists only IDs, survives a new store/page and keeps snapshots stable between changes', () => {
    const env = environment();
    const store = createVehicleFavoritesStore(env.port);
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    store.toggle('car-1');
    store.toggle('car-2');
    expect(JSON.parse(env.raw()!)).toEqual({ version: 1, ids: ['car-2', 'car-1'] });
    expect(createVehicleFavoritesStore(env.port).getSnapshot()).toEqual(['car-2', 'car-1']);
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it('notifies every same-document consumer and stops notifying unsubscribed consumers', () => {
    const env = environment(),
      store = createVehicleFavoritesStore(env.port);
    const first = vi.fn(),
      second = vi.fn();
    const stopFirst = store.subscribe(first),
      stopSecond = store.subscribe(second);
    store.toggle('car-1');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    stopFirst();
    store.remove('car-1');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
  });

  it('applies cross-tab edits and clear events, ignoring corrupt or unrelated messages', () => {
    const env = environment(saved(['car-1'])),
      store = createVehicleFavoritesStore(env.port);
    const stop = store.subscribe(() => {});
    env.emit({ key, newValue: saved(['car-2', 'car-1']) });
    expect(store.getSnapshot()).toEqual(['car-2', 'car-1']);
    env.emit({ key: 'other-app', newValue: saved(['unrelated']) });
    env.emit({ key, newValue: '{invalid' });
    expect(store.getSnapshot()).toEqual(['car-2', 'car-1']);
    store.toggle('car-3');
    expect(JSON.parse(env.raw()!).ids).toEqual(['car-3', 'car-2', 'car-1']);
    env.emit({ key: null, newValue: null });
    expect(store.getSnapshot()).toEqual([]);
    stop();
  });

  it('reads the latest persisted IDs before a mutation even when a tab event has not arrived', () => {
    const env = environment(),
      first = createVehicleFavoritesStore(env.port),
      second = createVehicleFavoritesStore(env.port);
    expect(second.getSnapshot()).toEqual([]);
    first.toggle('car-1');
    second.toggle('car-2');
    expect(second.getSnapshot()).toEqual(['car-2', 'car-1']);
    // Re-subscribing after time without a listener also catches up with persisted edits.
    const stop = first.subscribe(() => {});
    expect(first.getSnapshot()).toEqual(['car-2', 'car-1']);
    stop();
  });

  it('catches a storage repair between the initial snapshot and first subscription', () => {
    const env = environment('{broken'),
      store = createVehicleFavoritesStore(env.port);
    expect(store.getSnapshot()).toEqual([]);
    // A second tab repaired the value before this page attached its storage listener.
    env.storage.setItem(key, saved(['car-1']));
    const stop = store.subscribe(() => {});
    expect(store.getSnapshot()).toEqual(['car-1']);
    store.toggle('car-2');
    expect(store.getSnapshot()).toEqual(['car-2', 'car-1']);
    stop();
  });

  it('keeps consecutive memory changes when writes fail and persists them after recovery', () => {
    const env = environment(saved([])),
      store = createVehicleFavoritesStore(env.port);
    env.storage.setItem.mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    store.toggle('car-1');
    store.toggle('car-2');
    expect(store.getSnapshot()).toEqual(['car-2', 'car-1']);
    expect(env.raw()).toBe(saved([]));
    env.storage.setItem.mockImplementation((_key, value) => {
      env.emit({ key, newValue: value });
    });
    store.toggle('car-3');
    expect(store.getSnapshot()).toEqual(['car-3', 'car-2', 'car-1']);
    expect(createVehicleFavoritesStore(env.port).getSnapshot()).toEqual([
      'car-3',
      'car-2',
      'car-1',
    ]);
  });

  it('handles denied reads and malformed JSON without losing later local toggles', () => {
    for (const denied of [false, true]) {
      const env = environment('{bad');
      if (denied) {
        env.storage.getItem.mockImplementation(() => {
          throw new Error('Storage disabled');
        });
        env.storage.setItem.mockImplementation(() => {
          throw new Error('Storage disabled');
        });
      }
      const store = createVehicleFavoritesStore(env.port);
      expect(store.getSnapshot()).toEqual([]);
      store.toggle('car-1');
      store.toggle('car-2');
      store.remove('car-1');
      expect(store.getSnapshot()).toEqual(['car-2']);
      store.clear();
      expect(store.getSnapshot()).toEqual([]);
    }
  });

  it('never reads browser storage during SSR and uses the same empty server snapshot after saving', () => {
    const env = environment(saved(['car-1']));
    const server = createVehicleFavoritesStore({ ...env.port, isBrowser: () => false });
    expect(server.getSnapshot()).toBe(EMPTY_VEHICLE_FAVORITES);
    expect(server.getServerSnapshot()).toBe(EMPTY_VEHICLE_FAVORITES);
    server.toggle('car-2');
    expect(env.storage.getItem).not.toHaveBeenCalled();
    expect(env.storage.setItem).not.toHaveBeenCalled();
    const browser = createVehicleFavoritesStore(env.port);
    expect(browser.getSnapshot()).toEqual(['car-1']);
    expect(browser.getServerSnapshot()).toBe(EMPTY_VEHICLE_FAVORITES);
  });

  it('ignores an unreadable or foreign storageArea and handles a real local clear safely', () => {
    const env = environment(saved(['car-1']));
    const target = new EventTarget();
    Object.defineProperty(target, 'localStorage', { value: env.storage });
    vi.stubGlobal('window', target);
    const store = createVehicleFavoritesStore(),
      changed = vi.fn();
    const stop = store.subscribe(changed);
    function send(area: unknown, clear = false) {
      const event = new Event('storage');
      Object.defineProperties(event, {
        key: { value: clear ? null : key },
        newValue: { value: clear ? null : saved(['car-2']) },
        storageArea: typeof area === 'function' ? { get: area as () => never } : { value: area },
      });
      target.dispatchEvent(event);
    }
    send(() => {
      throw new Error('Denied storageArea');
    });
    send({});
    expect(store.getSnapshot()).toEqual(['car-1']);
    expect(changed).not.toHaveBeenCalled();
    send(env.storage, true);
    expect(store.getSnapshot()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });
});
