import type { VehicleDraftInput, LocalizationData, ExternalOverrides, ActivityEvent } from '@hd/contracts/admin';

export type ActivityChange = NonNullable<ActivityEvent['changes']>[number];
type ChangeValue = ActivityChange['before'];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value;
export const sameValue = (before: unknown, after: unknown) => JSON.stringify(normalized(before)) === JSON.stringify(normalized(after));

/** Only call on the explicit projections below, never on requests or source/provider responses. */
export function activityChanges(before: unknown, after: unknown, path = ''): ActivityChange[] {
  if (before === after || (before !== undefined && after !== undefined && sameValue(before, after))) return [];
  if (object(before) || object(after) || Array.isArray(before) || Array.isArray(after)) {
    const a = before && typeof before === 'object' ? before : {};
    const b = after && typeof after === 'object' ? after : {};
    const keys=[...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    if(!keys.length)return [{path,beforePresent:before!==undefined,afterPresent:after!==undefined,before:(before??null) as ChangeValue,after:(after??null) as ChangeValue}];
    return keys.flatMap(key => activityChanges(
      (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
  }
  return [{ path, beforePresent: before !== undefined, afterPresent: after !== undefined, before: (before ?? null) as ChangeValue, after: (after ?? null) as ChangeValue }];
}
const content = (field: VehicleDraftInput['content']['title']) => ({ sourceText: field.sourceText, sourceLanguage: field.sourceLanguage,
  translations: Object.fromEntries(Object.entries(field.translations).map(([locale, value]) => [locale, value && {
    text: value.text, kind: value.kind, reviewStatus: value.reviewStatus,
  }])) });
export function draftActivity(draft: VehicleDraftInput) {
  const source=draft.source.kind==='external'?{kind:draft.source.kind,platform:draft.source.platform,externalId:draft.source.externalId,collectedAt:draft.source.collectedAt,sourceUpdatedAt:draft.source.sourceUpdatedAt}:{kind:draft.source.kind};
  return { source, facts: draft.facts, price: draft.price,
    content: { title: content(draft.content.title), description: content(draft.content.description) },
    configuration: draft.configuration ?? null,
    media: Object.fromEntries(draft.media.map(({ id, alt, sortOrder, isCover }) => [id, { id, alt, sortOrder, isCover }])) };
}
export function draftChanges(before: VehicleDraftInput | null, after: VehicleDraftInput): ActivityChange[] {
  const changes = activityChanges(before && draftActivity(before), draftActivity(after), 'draft');
  if(after.source.kind==='external' && (!before || before.source.kind!=='external' || before.source.listingUrl!==after.source.listingUrl))changes.push({path:'draft.source.listingUrl',beforePresent:before?.source.kind==='external',afterPresent:true,before:before?.source.kind==='external'?'[redacted URL]':null,after:'[redacted URL]'});
  if (before && !sameValue(before.internal, after.internal)) changes.push({ path: 'draft.internal', beforePresent:true, afterPresent:true, before: '[redacted]', after: '[redacted]' });
  return changes;
}
export const localizationActivity = (data: LocalizationData) => ({ facts: data.facts,
  fields: Object.fromEntries(data.fields.map(field => [field.ref, content(field)])) });
export const overrideActivity = (data: ExternalOverrides) => ({ hidden: data.hidden, facts: data.facts,
  text: data.text.map(({ field, locale, text }) => ({ field, locale, text })) });
