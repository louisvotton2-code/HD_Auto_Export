type TrackingConsent = 'pending' | 'accepted' | 'declined';

type Listener = () => void;

const choiceKey = 'hd-auto:privacy-choice:v3';
const advertisingKey = 'hd-auto:meta-advertising:v2';
// Keep both existing keys so refusals also reach tabs running the previous bundle.
const advertisingGrant = 'allow-sdk';
let choice: TrackingConsent | undefined;
let analyticsGeneration = 0;
const listeners = new Set<Listener>();

function readStoredChoice(): TrackingConsent | undefined {
  try {
    const stored = window.localStorage.getItem(choiceKey);
    const advertising = window.localStorage.getItem(advertisingKey);
    if (stored === 'deny' || advertising === 'deny') return 'declined';
    // Partial grants from the previous banner require one new decision for the combined scope.
    return stored === 'allow' && advertising === advertisingGrant ? 'accepted' : 'pending';
  }
  catch { return undefined; }
}

export function getTrackingConsent(): TrackingConsent {
  if (typeof window === 'undefined' || window.parent !== window) return 'pending';
  return choice ??= readStoredChoice() ?? 'pending';
}

/** Only in-memory. Deferred success events must remain in the same grant as the user action. */
export function currentAnalyticsGrant() {
  return getTrackingConsent() === 'accepted' ? analyticsGeneration : null;
}

function notify(next: TrackingConsent) {
  if (choice === next) return;
  if ((choice === 'accepted') !== (next === 'accepted')) analyticsGeneration++;
  choice = next;
  for (const listener of listeners) listener();
}

function storeChoice(key: string, value: 'allow' | 'deny' | typeof advertisingGrant) {
  try { window.localStorage.setItem(key, value); }
  catch { /* Keep the current tab usable when storage is blocked. */ }
}

export function saveTrackingConsent(accepted: boolean) {
  if (typeof window === 'undefined' || window.parent !== window) return;
  storeChoice(choiceKey, accepted ? 'allow' : 'deny');
  storeChoice(advertisingKey, accepted ? advertisingGrant : 'deny');
  notify(accepted ? 'accepted' : 'declined');
}

export function refreshTrackingConsent() {
  if (typeof window === 'undefined' || window.parent !== window) return;
  const current = readStoredChoice();
  if (current) notify(current);
}

function storageChanged(event: StorageEvent) {
  if (event.key !== choiceKey && event.key !== advertisingKey && event.key !== null) return;
  try {
    if (event.storageArea === window.localStorage) refreshTrackingConsent();
  } catch { /* The current tab can retain its explicit in-memory choice. */ }
}

export function subscribeTrackingConsent(listener: Listener) {
  if (typeof window === 'undefined' || window.parent !== window) return () => {};
  if (!listeners.size) window.addEventListener('storage', storageChanged);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', storageChanged);
  };
}
