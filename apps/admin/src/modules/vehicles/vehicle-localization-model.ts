import {
  BRAND_CATALOG, findBrand, getDisplayTextLimit, SaveVehicleLocalizationSchema, type AdminVehicle, type DisplayField, type DisplayTranslationSuggestions,
  type LocalizationData, type Locale, type VehicleLocalization,
} from '@hd/contracts/admin';

export const displayLocales = ['zh', 'en', 'ru'] as const;
export const displayLocaleLabels = { zh: '中文', en: '英文', ru: '俄文' };
export const drivetrainLabels = { fwd: '前轮驱动', rwd: '后轮驱动', awd: '全轮驱动', four_wd: '四轮驱动' };
export class LocalizationContextChanged extends Error {}
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function localizationChanged(base: VehicleLocalization | null, data: LocalizationData | null): boolean {
  return !!base && !!data && !equal(base.data, data);
}
export function localizationSaveRequest(base: VehicleLocalization, data: LocalizationData) {
  // Unknown source languages remain unknown. Only generation/review needs an explicitly saved language.
  return SaveVehicleLocalizationSchema.parse({ vehicleVersion: base.vehicleVersion, revision: base.revision, data });
}
export function displayFieldLabel(field: DisplayField, fields: DisplayField[], vehicle: AdminVehicle): string {
  const labels: Record<string, string> = { make: '品牌名称', model: '车型名称', trim: '配置名称', generation: '代系名称', 'location.city': '所在地城市', 'location.displayName': '所在地说明', 'source.platform': '来源平台名称' };
  if (labels[field.ref]) return labels[field.ref];
  if (field.ref.startsWith('media.')) {
    const id = field.ref.slice('media.'.length, -'.alt'.length);
    const index = [...vehicle.draft.media].sort((a, b) => a.sortOrder - b.sortOrder).findIndex(media => media.id === id);
    return index < 0 ? '图片说明（图片已变化）' : `图片 ${index + 1} 说明`;
  }
  if (field.ref.startsWith('price.includes.')) return `费用条目 ${fields.filter(item => item.ref.startsWith('price.includes.')).findIndex(item => item.ref === field.ref) + 1}`;
  return '公开展示文字';
}
export function changeDisplayLanguage(field: DisplayField, language: string): DisplayField {
  if (language === field.sourceLanguage) return field;
  const result = structuredClone(field);result.sourceLanguage = language;
  for (const locale of displayLocales) if (result.translations[locale]) result.translations[locale]!.reviewStatus = 'stale';
  return result; // Server owns sourceVersion/hash and increments them only after PUT.
}
function sameSource(field: DisplayField, saved: DisplayField): boolean {
  return field.ref === saved.ref && field.sourceLanguage === saved.sourceLanguage && field.sourceText === saved.sourceText && field.sourceVersion === saved.sourceVersion && field.sourceHash === saved.sourceHash;
}
export function displayReviewState(field: DisplayField, saved: DisplayField, locale: Locale): 'empty' | 'pending' | 'approved' | 'stale' {
  const translation = field.translations[locale];if (!translation) return 'empty';
  if (!sameSource(field, saved) || translation.sourceVersion !== field.sourceVersion) return 'stale';
  if (translation.kind === 'original' && (field.sourceLanguage.split('-')[0] !== locale || translation.text !== field.sourceText)) return 'pending';
  return translation.reviewStatus;
}
export function editDisplayTranslation(field: DisplayField, saved: DisplayField, locale: Locale, text: string): DisplayField {
  if (text === (field.translations[locale]?.text ?? '')) return field;
  return { ...field, translations: { ...field.translations, [locale]: !text.trim() ? null : {
    text, kind: locale === field.sourceLanguage.split('-')[0] && text === field.sourceText ? 'original' : 'human',
    reviewStatus: sameSource(field, saved) ? 'pending' : 'stale', sourceVersion: field.sourceVersion,
    humanEditVersion: saved.translations[locale]?.humanEditVersion ?? 0, engineVersion: null,
  } } };
}
export function reviewDisplayTranslation(field: DisplayField, saved: DisplayField, locale: Locale, approved: boolean): DisplayField {
  const translation = field.translations[locale];
  if (!translation?.text.trim() || !sameSource(field, saved) || field.sourceLanguage.split('-')[0] === 'und') return field;
  const invalidOriginal = translation.kind === 'original' && (field.sourceLanguage.split('-')[0] !== locale || translation.text !== field.sourceText);
  return { ...field, translations: { ...field.translations, [locale]: {
    ...translation, ...(invalidOriginal ? { kind: 'human' as const, engineVersion: null } : {}),
    sourceVersion: field.sourceVersion, humanEditVersion: saved.translations[locale]?.humanEditVersion ?? 0,
    reviewStatus: approved ? 'approved' : 'pending',
  } } };
}
export function assertLocalizationSnapshot(expected: VehicleLocalization, fresh: VehicleLocalization): void {
  if (fresh.vehicleId !== expected.vehicleId || fresh.vehicleVersion !== expected.vehicleVersion || fresh.revision !== expected.revision || !equal(fresh.data, expected.data))
    throw new LocalizationContextChanged('车辆或多语资料已变化，旧建议没有覆盖当前输入。请比较最新版本。');
}
/** A self-consistent read pair may still predate a newer parent save or accepted sidecar revision. */
export function assertLocalizationReadNotOlder(
  currentVehicle: Pick<AdminVehicle, 'id' | 'version' | 'deletedAt'>,
  freshVehicle: Pick<AdminVehicle, 'id' | 'version' | 'deletedAt'>,
  fresh: VehicleLocalization,
  known: VehicleLocalization | null,
): void {
  if (currentVehicle.deletedAt || freshVehicle.deletedAt || freshVehicle.id !== currentVehicle.id || fresh.vehicleId !== currentVehicle.id ||
      fresh.vehicleVersion !== freshVehicle.version || freshVehicle.version < currentVehicle.version ||
      known && (known.vehicleId !== fresh.vehicleId || fresh.vehicleVersion < known.vehicleVersion || fresh.revision < known.revision))
    throw new LocalizationContextChanged('已忽略早于当前车辆或多语版本的读取结果，当前输入已保留。请重新读取多语资料。');
}
export function applyDisplaySuggestions(base: VehicleLocalization, current: LocalizationData, suggestion: DisplayTranslationSuggestions, refs: string[]): { data: LocalizationData; applied: number; protected: number } {
  const changed = () => new LocalizationContextChanged('展示字段、来源或人工版本已变化，本次建议没有覆盖当前输入。');
  if (suggestion.vehicleId !== base.vehicleId || suggestion.vehicleVersion !== base.vehicleVersion || suggestion.revision !== base.revision || !equal(base.data, current)) throw changed();
  if (suggestion.fields.length !== refs.length || new Set(suggestion.fields.map(field => field.ref)).size !== refs.length || suggestion.fields.some(field => !refs.includes(field.ref))) throw changed();
  const data = structuredClone(current);let applied = 0;let protectedCount = 0;
  for (const next of suggestion.fields) {
    const saved = base.data.fields.find(field => field.ref === next.ref);const field = data.fields.find(item => item.ref === next.ref);
    if (!saved || !field || saved.sourceLanguage.split('-')[0] !== 'zh' || !sameSource(next, saved)) throw changed();
    for (const locale of displayLocales) {
      const prior = saved.translations[locale];const translated = next.translations[locale];
      if (translated && translated.humanEditVersion !== (prior?.humanEditVersion ?? 0)) throw changed();
      if (prior?.kind === 'human' || prior?.reviewStatus === 'approved') { protectedCount++;continue; }
      if (!translated || translated.text.length > getDisplayTextLimit(next.ref) || translated.sourceVersion !== saved.sourceVersion || translated.reviewStatus !== 'pending' || (locale === 'zh' ? translated.kind !== 'original' || translated.text !== saved.sourceText || translated.engineVersion !== null : translated.kind !== 'machine' || !translated.engineVersion)) throw changed();
      field.translations[locale] = structuredClone(translated);applied++;
    }
  }
  return { data, applied, protected: protectedCount };
}
export function localizationComparison(local: LocalizationData, remote: LocalizationData, vehicle: AdminVehicle): Array<{ key: string; label: string; local: string; remote: string }> {
  const rows: Array<{ key: string; label: string; local: string; remote: string }> = [];
  const push = (key: string, label: string, before: unknown, after: unknown) => {
    if (!equal(before, after)) rows.push({ key, label, local: typeof before === 'string' ? before || '未填写' : JSON.stringify(before) ?? '未填写', remote: typeof after === 'string' ? after || '未填写' : JSON.stringify(after) ?? '未填写' });
  };
  push('generation', '代系名称', local.facts.generation?.name ?? '', remote.facts.generation?.name ?? '');
  push('drivetrain', '驱动形式', local.facts.drivetrain ? drivetrainLabels[local.facts.drivetrain] : '未知', remote.facts.drivetrain ? drivetrainLabels[remote.facts.drivetrain] : '未知');
  const refs = new Set([...local.fields, ...remote.fields].map(field => field.ref));
  for (const ref of refs) {
    const left = local.fields.find(field => field.ref === ref);const right = remote.fields.find(field => field.ref === ref);const field = left ?? right!;
    const label = displayFieldLabel(field, local.fields.length ? local.fields : remote.fields, vehicle);
    push(`${ref}:source`, `${label}原文/语言`, left ? `${left.sourceText}（${left.sourceLanguage}）` : '字段已移除', right ? `${right.sourceText}（${right.sourceLanguage}）` : '字段已移除');
    for (const locale of displayLocales) {
      const a = left?.translations[locale], b = right?.translations[locale];
      if (!equal(a, b)) push(`${ref}:${locale}`, `${label} · ${displayLocaleLabels[locale]}`, a ? `${a.text}（${a.reviewStatus}）` : '未填写', b ? `${b.text}（${b.reviewStatus}）` : '未填写');
    }
  }
  return rows;
}
export function brandIdentityOptions(choices: Array<{ id: string; name: string }>, selected: { id: string; name: string }): Array<{ value: string; label: string; rawName: string }> {
  const all = [...choices];if (selected.id && !all.some(item => item.id === selected.id)) all.push(selected);
  const options = all.map(item => {
    const brand = findBrand(item);
    return { value: item.id, rawName: item.name, label: brand ? `${brand.labels.zh} / ${brand.labels.en}${item.id !== brand.catalogId ? '（现有记录）' : ''}` : item.name };
  });
  for (const brand of BRAND_CATALOG) if (!options.some(item => item.value === brand.catalogId)) options.push({ value: brand.catalogId, label: `${brand.labels.zh} / ${brand.labels.en}`, rawName: brand.labels.zh });
  return options;
}
