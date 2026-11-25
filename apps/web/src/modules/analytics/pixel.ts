import { AnalyticsVehicleIdSchema } from '@hd/contracts/analytics';
import { getTrackingConsent } from '@/shared/lib/tracking-consent';
import { isPixelId, vehiclePixelPath } from './pixel-config';

type ContactChannel = 'whatsapp' | 'telegram';
type MetaCommand = unknown[];
type Fbq = {
  (...args: MetaCommand): void;
  callMethod?: (...args: MetaCommand) => void;
  instance?: {
    configsLoaded: Record<string, boolean>;
    asyncParamPromisesAllSettled?: boolean;
    locks: { isLocked(): boolean; onUnlocked(listener: () => void): void };
  };
  push: Fbq;
  queue: MetaCommand[];
  loaded: boolean;
  version: '2.0';
  disablePushState: boolean;
};
type PixelWindow = Window & { fbq?: Fbq; _fbq?: Fbq };

type VehicleView = {
  pixelId: string;
  vehicleId: string;
  path: string;
  isCurrent: () => boolean;
  viewed: boolean;
  contacts: ContactChannel[];
};

let current: VehicleView | undefined;
let sdk: Fbq | undefined;
let initializedId: string | undefined;
let granted = false;
let ready = false;
let hintsCheck: ReturnType<typeof setTimeout> | undefined;
let hintsChecksLeft = 0;
let failed = false;

function eligible(view: VehicleView) {
  return current === view && getTrackingConsent() === 'accepted' && location.pathname === view.path &&
    !('prerendering' in document && document.prerendering) && view.isCurrent();
}

/** Cancel delayed events when the detail or its permission expires. No replay on another visit. */
export function stopVehiclePixel() {
  current = undefined;
  clearTimeout(hintsCheck);
  hintsCheck = undefined;
  if (granted) {
    granted = false;
    sdk?.('consent', 'revoke');
  }
}

function dispatch() {
  const view = current;
  if (!view || !ready || !sdk?.callMethod || failed) return;
  if (!eligible(view)) {
    stopVehiclePixel();
    return;
  }
  const id = view.pixelId;
  if (initializedId && initializedId !== id) return;
  if (!granted) {
    granted = true;
    sdk('consent', 'grant');
  }
  if (!initializedId) {
    sdk('set', 'autoConfig', false, id);
    sdk('init', id);
    // Limit the SDK to our explicit events, including on browser back/forward restoration.
    sdk('set', 'trackSingleOnly', true, id);
    initializedId = id;
  }
  // fbevents.js also loads the pixel's configuration asynchronously. Sending while locked
  // would let the SDK replay an event later using the URL of a different vehicle.
  if (!sdk.instance?.configsLoaded[id] || sdk.instance.locks.isLocked()) return;
  // Client hints have a separate internal queue. Keep pending clicks here so a withdrawal
  // can cancel them. This check is bounded even when a browser extension stalls the SDK.
  if (sdk.instance.asyncParamPromisesAllSettled === false) {
    if (hintsCheck !== undefined) return;
    if (hintsChecksLeft === 0) {
      failed = true;
      stopVehiclePixel();
      return;
    }
    hintsChecksLeft--;
    hintsCheck = setTimeout(() => {
      hintsCheck = undefined;
      flush();
    }, 100);
    return;
  }
  const vehicle = { content_type: 'product', content_ids: [view.vehicleId] };
  if (!view.viewed) {
    view.viewed = true;
    sdk('trackSingle', id, 'PageView');
    sdk('trackSingle', id, 'ViewContent', vehicle);
  }
  for (const channel of view.contacts.splice(0)) {
    sdk('trackSingle', id, 'Contact', { ...vehicle, contact_channel: channel });
  }
}

let dispatching = false;
function flush() {
  if (dispatching) return;
  dispatching = true;
  try {
    dispatch();
  } finally {
    dispatching = false;
  }
}

function loadSdk() {
  const browser = window as PixelWindow;
  if (sdk || failed) return;
  // A separate installation could already be collecting automatic events for another ID.
  if (browser.fbq || browser._fbq) return;
  const fbq: Fbq = function (...args: MetaCommand) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  };
  fbq.push = fbq;
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.disablePushState = true;
  sdk = browser.fbq = browser._fbq = fbq;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  script.onload = () => {
    const locks = fbq.instance?.locks;
    if (!locks?.onUnlocked || !locks.isLocked || !fbq.instance?.configsLoaded) {
      failed = true;
      stopVehiclePixel();
      return;
    }
    // One listener per document. Nothing enters the SDK's replay queue while permissions change.
    ready = true;
    locks.onUnlocked(flush);
    flush();
  };
  script.onerror = () => {
    failed = true;
    stopVehiclePixel();
  };
  document.head.append(script);
}

export function startVehiclePixel(pixelId: string, vehicleId: string, isCurrent: () => boolean) {
  if (typeof window === 'undefined' || window.parent !== window || !isPixelId(pixelId) || failed ||
      !AnalyticsVehicleIdSchema.safeParse(vehicleId).success || getTrackingConsent() !== 'accepted' ||
      vehiclePixelPath.exec(location.pathname)?.[1] !== vehicleId || !isCurrent() ||
      ('prerendering' in document && document.prerendering)) return;
  if (current?.pixelId === pixelId && current.path === location.pathname && current.vehicleId === vehicleId) return;
  stopVehiclePixel();
  hintsChecksLeft = 100;
  current = { pixelId, vehicleId, path: location.pathname, isCurrent, viewed: false, contacts: [] };
  loadSdk();
  flush();
}

export function trackVehiclePixelContact(vehicleId: string, channel: ContactChannel) {
  if (!current || current.vehicleId !== vehicleId || !eligible(current) || current.contacts.length >= 16) return;
  current.contacts.push(channel);
  flush();
}
