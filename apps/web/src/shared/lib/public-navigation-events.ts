'use client';

type NavigationSignal = { id: number; path: string; ready: boolean };
let last: NavigationSignal | null = null;
let sequence = 0;
const listeners = new Set<(signal: NavigationSignal) => void>();
export function startPublicNavigation() {
  last = { id: ++sequence, path: location.pathname, ready: false };
  for (const listener of listeners) listener(last);
}
export function finishPublicNavigation() {
  if (!last) return;
  last = { ...last, ready: true };
  for (const listener of listeners) listener(last);
}
export function discardPublicNavigationAfterLeaving(path: string) {
  if (last && last.path !== path) last = null;
}
export function publicNavigationVersion(path: string) {
  return last?.path === path ? last.id : 0;
}
export function subscribePublicNavigation(listener: (signal: NavigationSignal) => void) {
  listeners.add(listener);
  // A restored page can mount after Next applies the history entry. Retain the signal until leaving that path.
  if (last && last.path === location.pathname) listener(last);
  return () => {
    listeners.delete(listener);
  };
}
