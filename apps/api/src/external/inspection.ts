import { ExternalInspectionContentSchema, type ExternalInspection } from '@hd/contracts/public';
import type { ExternalUpsertCandidate } from '@hd/contracts/admin';

type Tagged = { text: string; contentLocale: string };
type Content = Omit<ExternalInspection, 'reportUrl' | 'reportAccess'>;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Reads only the agreed report leaves; neither photo URLs nor detection totals become history events. */
export function sourceInspectionContent(report: JsonObject | undefined, text: (value: unknown, language: 'en' | 'zh') => Tagged | null): Pick<Content, 'checks' | 'defects'> {
  let remaining = 1000;
  const checks: NonNullable<Content['checks']> = [];
  for (const raw of array(report?.checks).slice(0, 30)) {
    const category = object(raw), label = text(category.category, 'en');
    if (!label) continue;
    const groups: NonNullable<Content['checks']>[number]['groups'] = [];
    for (const rawGroup of array(category.groups).slice(0, 100)) {
      const group = object(rawGroup), name = text(group.name, 'en');
      if (!name) continue;
      const items: typeof groups[number]['items'] = [];
      for (const rawItem of array(group.items).slice(0, remaining)) {
        const item = object(rawItem), part = text(item.part, 'en');
        if (!part) continue;
        items.push({ part, result: text(item.result, 'en'), ok: typeof item.ok === 'boolean' ? item.ok : null });
        remaining--;
      }
      if (items.length) groups.push({ name, defects: count(group.defects), items });
    }
    if (groups.length) checks.push({ category: label, defects: count(category.defects), groups });
  }
  const defects: NonNullable<Content['defects']> = [];
  for (const raw of array(report?.defects).slice(0, 30)) {
    const category = object(raw), label = text(category.category, 'en');
    if (!label) continue;
    const items: NonNullable<Content['defects']>[number]['items'] = [];
    for (const rawItem of array(category.items).slice(0, remaining)) {
      if (!remaining) break;
      const item = object(rawItem), group = text(item.group, 'en'), part = text(item.part, 'en'), finding = text(item.finding, 'en');
      if (!group || !part || !finding) continue;
      remaining--;
      const details: typeof items[number]['details'] = [];
      for (const rawDetail of array(item.details).slice(0, Math.min(remaining, 100))) {
        const detail = object(rawDetail), english = text(detail.text, 'en'), chinese = text(detail.textZh, 'zh');
        if (!english && !chinese) continue;
        details.push({ text: english, textZh: chinese }); remaining--;
      }
      items.push({ group, part, finding, details });
    }
    if (items.length) defects.push({ category: label, count: count(category.count), items });
  }
  return { checks, defects };
}

/** Defense in depth for all source adapters, including ordinary candidate imports. */
export function safeInspectionContent(input: NonNullable<ExternalUpsertCandidate['inspection']>, isPublicText: (text: string) => boolean): Content {
  const safe = (value: Tagged | null): Tagged | null => value && isPublicText(value.text) ? value : null;
  const checks = input.checks?.flatMap(category => {
    if (!safe(category.category)) return [];
    return [{ category: category.category, defects: category.defects, groups: category.groups.flatMap(group => {
      if (!safe(group.name)) return [];
      return [{ name: group.name, defects: group.defects, items: group.items.flatMap(item => safe(item.part)
        ? [{ part: item.part, result: safe(item.result), ok: item.ok }] : []) }];
    }) }];
  });
  const defects = input.defects?.flatMap(category => {
    if (!safe(category.category)) return [];
    return [{ category: category.category, count: category.count, items: category.items.flatMap(item => {
      if (!safe(item.group) || !safe(item.part) || !safe(item.finding)) return [];
      return [{ group: item.group, part: item.part, finding: item.finding, details: item.details.flatMap(detail => {
        const text = safe(detail.text), textZh = safe(detail.textZh);
        return text || textZh ? [{ text, textZh }] : [];
      }) }];
    }) }];
  });
  return ExternalInspectionContentSchema.parse({ entries: input.entries.filter(entry => safe(entry.name) && safe(entry.value)),
    ...(checks ? { checks } : {}), ...(defects ? { defects } : {}) });
}
