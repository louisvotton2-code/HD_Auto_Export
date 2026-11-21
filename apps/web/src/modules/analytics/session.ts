import { AnalyticsEntrySchema, type AnalyticsEvent } from '@hd/contracts/analytics';

type Acquisition = Required<Pick<AnalyticsEvent, 'source' | 'campaign' | 'device'>>;
type Session = Acquisition & {
  sessionId: string;
  sequence: number;
  entry: NonNullable<AnalyticsEvent['entry']>;
  lastActivity: number;
};
type SessionFields = Omit<Session, 'lastActivity'>;

const lifetime = 30 * 60 * 1000;
const storageKey = 'hd-auto:analytics-session:v2';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sources = ['unknown', 'direct', 'search', 'meta', 'social', 'referral', 'paid'] as const;
const campaigns = ['none', 'brand', 'catalog', 'retargeting'] as const;
const devices = ['unknown', 'mobile', 'tablet', 'desktop'] as const;
const matches = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);

export function acquisition({ href, referrer, width, touch }: {
  href: string; referrer: string; width: number; touch: boolean;
}): Acquisition {
  const url = new URL(href);
  const campaignValue = url.searchParams.get('utm_campaign')?.trim().toLowerCase();
  const campaign = campaigns.find(item => item === campaignValue) ?? 'none';
  const medium = url.searchParams.get('utm_medium')?.trim().toLowerCase();
  const device = width <= 600 ? 'mobile' : width <= 1100 && touch ? 'tablet' : 'desktop';
  let source: Acquisition['source'] = 'direct';
  if (medium === 'cpc' || medium === 'ppc' || medium === 'paid' || medium === 'paid_social') {
    source = 'paid';
  } else if (referrer) {
    try {
      const from = new URL(referrer);
      const host = from.hostname;
      if (from.origin === url.origin) source = 'unknown';
      else if (['facebook.com', 'instagram.com', 'fb.com', 'messenger.com'].some(name => matches(host, name))) source = 'meta';
      else if (['google.com', 'google.ru', 'yandex.ru', 'yandex.com', 'bing.com', 'baidu.com', 'duckduckgo.com'].some(name => matches(host, name))) source = 'search';
      else if (['t.me', 'telegram.org', 'vk.com', 'youtube.com', 'tiktok.com', 'x.com', 'twitter.com'].some(name => matches(host, name))) source = 'social';
      else source = 'referral';
    } catch { source = 'unknown'; }
  }
  return { source, campaign, device };
}

function valid(session: Session | null, now: number): session is Session {
  return session !== null && typeof session === 'object' && uuid.test(session.sessionId) &&
    Number.isInteger(session.sequence) && session.sequence >= 0 && session.sequence < 2_147_483_647 &&
    Number.isFinite(session.lastActivity) && now >= session.lastActivity && now - session.lastActivity < lifetime &&
    sources.includes(session.source) && campaigns.includes(session.campaign) && devices.includes(session.device) &&
    AnalyticsEntrySchema.safeParse(session.entry).success;
}

let memory: Session | null = null;

export function nextAnalyticsSession(pageType: AnalyticsEvent['pageType'], now: number): SessionFields {
  let prior = memory;
  try {
    const stored = sessionStorage.getItem(storageKey);
    prior = stored ? JSON.parse(stored) as Session : null;
  } catch { /* Keep one bounded in-memory session while storage is unavailable. */ }
  const fields = valid(prior, now)
    ? {
      sessionId: prior.sessionId, sequence: prior.sequence + 1, entry: prior.entry,
      source: prior.source, campaign: prior.campaign, device: prior.device,
    }
    : { sessionId: crypto.randomUUID(), sequence: 0, entry: pageType, ...acquisition({
      href: location.href, referrer: document.referrer, width: window.innerWidth,
      touch: window.matchMedia('(pointer: coarse)').matches,
    }) };
  memory = { ...fields, lastActivity: now };
  try { sessionStorage.setItem(storageKey, JSON.stringify(memory)); } catch { /* Storage is optional. */ }
  return fields;
}

export function clearAnalyticsSession() {
  memory = null;
  try { sessionStorage.removeItem(storageKey); } catch { /* No persisted session is accessible. */ }
}
