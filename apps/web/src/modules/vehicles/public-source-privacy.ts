import type { PublicVehicle, PublicVehicleCard } from '@hd/contracts/public';
import { siteConfig } from '@/shared/config/site';
import { publicVehicleReference } from '@/shared/lib/public-vehicle-reference';

const knownPlatformNames = [
  '懂车帝', 'Dongchedi', 'Dong Che Di', '车168', 'Che168', '汽车之家',
  '瓜子二手车', 'Guazi', 'ChinaCarAPI',
];
const knownPlatformHosts = /^(?:[\w-]+\.)*(?:dongchedi\.com|che168\.com|autohome\.com\.cn|guazi\.com|chinacarapi\.com)$/i;
const oldInquiryCode = /\b(?:dongchedi|dcd|che168|guazi)[-_:][\w.-]+/gi;
const proseFields = new Set(['text', 'name', 'alt', 'city', 'displayName', 'includes']);

function scrubber(labels: readonly string[] = [], hosts: readonly string[] = []) {
  const names = [...new Set([...knownPlatformNames, ...labels].map(label => label.trim()))]
    .filter(label => label.length > 1)
    .sort((a, b) => b.length - a.length)
    .map(label => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return /^\w/.test(label) && /\w$/.test(label) ? `\\b${escaped}\\b` : escaped;
    });
  const mentions = new RegExp(names.join('|'), 'gi');
  return (value: string) => value
    .replace(/https?:\/\/[^\s<>“”"'，。]+/gi, url => {
      const host = URL.canParse(url) ? new URL(url).hostname : '';
      return hosts.includes(host) || knownPlatformHosts.test(host) ? '…' : url;
    })
    .replace(/(?:[\w-]+\.)+[a-z]{2,}(?=\b)/gi, host =>
      hosts.includes(host.toLowerCase()) || knownPlatformHosts.test(host) ? '…' : host,
    )
    .replace(oldInquiryCode, '…')
    .replace(mentions, '…');
}

/** Redact supplier mentions in prose without rewriting IDs, language tags, money or image URLs. */
export function redactPublicVehicleProse<T>(value: T, scrub = scrubber()): T {
  function visit(value: unknown, prose = false): unknown {
    if (typeof value === 'string') return prose ? scrub(value) : value;
    if (Array.isArray(value)) return value.map(entry => visit(entry, prose));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry, proseFields.has(key))]));
    return value;
  }
  return visit(value) as T;
}

/** Keep the public contract shape for browser refreshes, without carrying upstream listing identity. */
export function publicSourcePrivacy<T extends PublicVehicle | PublicVehicleCard>(vehicle: T): T {
  const { source, identifiers, display } = vehicle;
  const code = publicVehicleReference(vehicle) ?? '—';
  const labels = [
    identifiers?.source,
    identifiers?.inquiryCode === code ? null : identifiers?.inquiryCode,
    display?.platform.text,
    source.kind === 'external' ? source.platform.name : null,
    source.kind === 'external' ? source.platform.id : null,
    vehicle.stockCode !== code ? vehicle.stockCode : null,
  ].filter((label): label is string => Boolean(label) && label?.toLowerCase() !== 'external' && label !== '—');
  const hosts = source.kind === 'external' && source.platform.id !== 'external'
    ? [new URL(source.listingUrl).hostname] : [];
  const clean = redactPublicVehicleProse(vehicle, scrubber(labels, hosts));
  clean.stockCode = code;
  if (source.kind === 'external') clean.source = {
    kind: 'external',
    platform: { id: 'external', name: 'External' },
    listingUrl: new URL(vehicle.detailPath, siteConfig.origin).href,
  };
  if (identifiers) clean.identifiers = { ...identifiers, source: null, sourceId: null, inquiryCode: code };
  if (display) clean.display!.platform = {
    status: 'missing', text: null, requestedLocale: display.platform.requestedLocale,
    contentLocale: null, provenance: null, reviewed: false,
  };
  if (clean.manufacture && source.kind === 'external') clean.manufacture.source = null;
  if ('external' in clean && clean.external?.detail) {
    clean.external.detail.original = { title: null, model: null, description: null };
    clean.external.detail.relatedListingUrls = [];
  }
  return clean;
}

export const redactPublicPlatformMentions = scrubber();
