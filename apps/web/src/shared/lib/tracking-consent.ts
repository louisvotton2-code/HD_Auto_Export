export type TrackingConsent = Readonly<{
  acknowledged: boolean;
  decided: boolean;
  analytics: boolean;
  advertising: boolean;
  advertisingDecided: boolean;
}>;

type Listener = () => void;

const choiceKey = 'hd-auto:privacy-choice:v3';
const advertisingKey = 'hd-auto:meta-advertising:v2';
// Keep the refusal shared with older tabs. Their lightweight Pixel grant did not cover the SDK.
const advertisingGrant = 'allow-sdk';
const undecided: TrackingConsent = {
  acknowledged: false, decided: false, analytics: false, advertising: false, advertisingDecided: false,
};
let choice: TrackingConsent | undefined;
let analyticsGeneration = 0;
const listeners = new Set<Listener>();

function readStoredChoice() {
  try {
    const stored = window.localStorage.getItem(choiceKey);
    const advertising = window.localStorage.getItem(advertisingKey);
    const decided = stored === 'allow' || stored === 'deny';
    return {
      acknowledged: decided || stored === 'read', decided, analytics: stored === 'allow',
      advertising: advertising === advertisingGrant,
      advertisingDecided: advertising === advertisingGrant || advertising === 'deny',
    };
  }
  catch { return undefined; }
}

export function getTrackingConsent(): TrackingConsent {
  if (typeof window === 'undefined' || window.parent !== window) return undecided;
  return choice ??= readStoredChoice() ?? undecided;
}

/** Only in-memory. Deferred success events must remain in the same grant as the user action. */
export function currentAnalyticsGrant() {
  return getTrackingConsent().analytics ? analyticsGeneration : null;
}

function notify(next: TrackingConsent) {
  const previous = choice;
  if (previous?.decided === next.decided && previous.analytics === next.analytics &&
      previous.acknowledged === next.acknowledged && previous.advertising === next.advertising &&
      previous.advertisingDecided === next.advertisingDecided) return;
  if (Boolean(previous?.analytics) !== next.analytics) analyticsGeneration++;
  choice = next;
  for (const listener of listeners) listener();
}

function storeChoice(key: string, value: 'read' | 'allow' | 'deny' | typeof advertisingGrant) {
  try { window.localStorage.setItem(key, value); }
  catch { /* Keep the current tab usable when storage is blocked. */ }
}

export function saveTrackingPreferences({ analytics, advertising }: { analytics?: boolean; advertising?: boolean }) {
  if (typeof window === 'undefined' || window.parent !== window) return;
  const previous = getTrackingConsent();
  if (analytics !== undefined) storeChoice(choiceKey, analytics ? 'allow' : 'deny');
  else if (!previous.acknowledged) storeChoice(choiceKey, 'read');
  if (advertising !== undefined) storeChoice(advertisingKey, advertising ? advertisingGrant : 'deny');
  notify({
    acknowledged: true,
    decided: analytics !== undefined || previous.decided,
    analytics: analytics ?? previous.analytics,
    advertisingDecided: advertising !== undefined || previous.advertisingDecided,
    advertising: advertising ?? previous.advertising,
  });
}

export function acceptPrivacyNotice(sessionAnalytics: boolean, meta = false) {
  saveTrackingPreferences({ analytics: sessionAnalytics || undefined, advertising: meta || undefined });
}

export function declineTrackingConsent(sessionAnalytics = true, meta = true) {
  saveTrackingPreferences({ analytics: sessionAnalytics ? false : undefined, advertising: meta ? false : undefined });
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
