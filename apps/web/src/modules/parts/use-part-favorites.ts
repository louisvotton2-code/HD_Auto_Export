'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { partFavoritesStore } from './favorites-store';

export function usePartFavorites(knownIds?: readonly string[]) {
  useEffect(() => { if (knownIds) partFavoritesStore.configureKnownIds(knownIds); }, [knownIds]);
  const ids = useSyncExternalStore(partFavoritesStore.subscribe, partFavoritesStore.getSnapshot, partFavoritesStore.getServerSnapshot);
  return { ids, toggle: partFavoritesStore.toggle };
}
