import { describe, expect, it } from 'vitest';
import { createPartFavoritesStore, partFavoritesStorageKey } from './favorites-store';
const known = ['52910k2200', '58920c1310'];

describe('browser-only part favorites', () => {
  it('stores a version and stable IDs only, restores them and synchronizes subscribers', () => {
    let raw: string | null = JSON.stringify({ version: 1, ids: ['52910k2200', '52910k2200', '../bad', 4] });
    const storage = { getItem: () => raw, setItem: (key: string, value: string) => { expect(key).toBe(partFavoritesStorageKey); raw = value; } };
    const store = createPartFavoritesStore(() => storage, known), seen: number[] = [];
    const first = store.subscribe(() => seen.push(store.getSnapshot().length));
    const second = store.subscribe(() => seen.push(store.getSnapshot().length));
    expect(store.getSnapshot()).toEqual(['52910k2200']);
    store.toggle('58920c1310');
    expect(JSON.parse(raw!)).toEqual({ version: 1, ids: ['52910k2200', '58920c1310'] });
    const restored = createPartFavoritesStore(() => storage, known); restored.refresh();
    expect(restored.getSnapshot()).toEqual(store.getSnapshot());
    raw = JSON.stringify({ version: 1, ids: ['58920c1310'] }); store.refresh();
    expect(store.getSnapshot()).toEqual(['58920c1310']);
    expect(seen.filter((n) => n === 2)).toHaveLength(2);
    first(); second();
  });
  it('treats corrupt or old payloads as an empty preference without erasing valid in-memory changes', () => {
    let raw = '{bad';
    const store = createPartFavoritesStore(() => ({ getItem: () => raw, setItem: (_, value) => { raw = value; } }), known);
    store.refresh(); expect(store.getSnapshot()).toEqual([]);
    store.toggle('52910k2200'); expect(store.getSnapshot()).toEqual(['52910k2200']);
    store.toggle('../bad'); expect(store.getSnapshot()).toEqual(['52910k2200']);
    raw = JSON.stringify({ version: 2, ids: ['52910k2200'] }); store.refresh(); expect(store.getSnapshot()).toEqual([]);
  });
  it('keeps a working memory preference when browser storage access or writes are denied', () => {
    for (const storage of [() => { throw new Error('SecurityError'); }, () => ({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } })]) {
      const store = createPartFavoritesStore(storage, known);
      store.refresh(); store.toggle('52910k2200'); store.refresh();
      expect(store.getSnapshot()).toEqual(['52910k2200']);
      store.toggle('58920c1310'); expect(store.getSnapshot()).toHaveLength(2);
      store.toggle('52910k2200'); expect(store.getSnapshot()).toEqual(['58920c1310']);
    }
  });
  it('rejects unknown identities and bounds loaded preferences to 100', () => {
    const identities = Array.from({ length: 120 }, (_, i) => `oem${i}`);
    const raw = JSON.stringify({ version: 1, ids: ['unlisted', ...identities] });
    const store = createPartFavoritesStore(() => ({ getItem: () => raw, setItem() {} }), identities);
    store.refresh(); expect(store.getSnapshot()).toHaveLength(100); expect(store.getSnapshot()).not.toContain('unlisted');
    store.toggle('anotherunknown'); expect(store.getSnapshot()).toHaveLength(100);
  });
});
