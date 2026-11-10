'use client';

type NavigationSignal = { id: number; path: string; ready: boolean };
let last: NavigationSignal | null = null;
const listeners = new Set<(signal: NavigationSignal) => void>();
export function startPublicNavigation() {
  last = { id: (last?.id ?? 0) + 1, path: location.pathname, ready: false };
  for (const listener of listeners) listener(last);
}
export function finishPublicNavigation() {
  if (!last) return;
  last = { ...last, ready: true };
  for (const listener of listeners) listener(last);
}
export function publicNavigationVersion(path: string) {
  return last?.path === path ? last.id : 0;
}
export function subscribePublicNavigation(listener: (signal: NavigationSignal) => void) {
  listeners.add(listener);
  // A restored page can mount after Next has applied the history entry. Do not expire this signal.
  if (last && last.path === location.pathname) listener(last);
  return () => {
    listeners.delete(listener);
  };
}
