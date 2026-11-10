'use client';

import { useSyncExternalStore } from 'react';
import { vehicleFavoritesStore } from './vehicle-favorites-store';

/** Empty SSR snapshot, followed by the browser's saved identities after hydration. */
export function useVehicleFavorites() {
  const ids = useSyncExternalStore(
    vehicleFavoritesStore.subscribe,
    vehicleFavoritesStore.getSnapshot,
    vehicleFavoritesStore.getServerSnapshot,
  );
  return {
    ids,
    isFavorite: (id: string) => ids.includes(id),
    toggle: vehicleFavoritesStore.toggle,
    remove: vehicleFavoritesStore.remove,
    clear: vehicleFavoritesStore.clear,
  };
}
