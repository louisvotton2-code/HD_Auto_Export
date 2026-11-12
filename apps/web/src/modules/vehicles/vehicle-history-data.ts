import type { ExternalPublicDetail, PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

type Entry = ExternalPublicDetail['specifications'][number];
type HistoryKind = 'accidents' | 'transfers' | 'owners' | 'plateChanges' | 'theft' | 'flood' | 'waterDamage' | 'fire' | 'totalLoss';
type Field = { kind: HistoryKind; count: boolean; aliases: readonly string[] };

// Only explicit published history fields qualify. Inspection defects are not accident counts.
const fields: readonly Field[] = [
  { kind: 'accidents', count: true, aliases: ['accidentCount', 'number of accidents', '事故次数', '事故数量', 'количество ДТП'] },
  { kind: 'accidents', count: false, aliases: ['accidents', 'accident history', 'accident records', '事故记录', '事故历史', 'история ДТП'] },
  { kind: 'transfers', count: true, aliases: ['ownership transfers', 'ownership changes', 'owner changes', 'transferCount', '过户次数', '所有权变更次数', 'количество переоформлений'] },
  { kind: 'owners', count: true, aliases: ['ownerCount', 'number of owners', '车主数量', '车主人数', 'количество владельцев'] },
  { kind: 'plateChanges', count: true, aliases: ['plate changes', 'plateChangeCount', '车牌变更次数', 'количество смен номеров'] },
  { kind: 'theft', count: true, aliases: ['theftCount', 'theft records count', '盗窃次数', '盗抢次数'] },
  { kind: 'theft', count: false, aliases: ['theft', 'theft history', 'stolen', 'isStolen', '盗窃记录', '盗抢记录', '被盗', 'угон', 'история угонов'] },
  { kind: 'flood', count: true, aliases: ['floodCount', 'floods', '洪水次数', '水淹次数'] },
  { kind: 'flood', count: false, aliases: ['flood history', 'flooded', 'isFlooded', '洪水记录', '水淹记录', 'затопление'] },
  { kind: 'waterDamage', count: false, aliases: ['water damage', 'waterDamage', 'water damage history', '泡水记录', '泡水', '进水记录', 'повреждение водой'] },
  { kind: 'fire', count: false, aliases: ['fire history', 'fire damage', 'fireDamage', '火烧记录', '火烧', 'пожар'] },
  { kind: 'totalLoss', count: false, aliases: ['total loss', 'totalLoss', '全损记录', '全损', 'полная гибель'] },
];
const labels = {
  zh: { accidents: '事故记录', transfers: '过户次数', owners: '车主数量', plateChanges: '车牌变更', theft: '盗窃记录', flood: '水淹记录', waterDamage: '泡水记录', fire: '火烧记录', totalLoss: '全损记录', yes: '有', no: '无' },
  en: { accidents: 'Accident records', transfers: 'Ownership transfers', owners: 'Number of owners', plateChanges: 'Plate changes', theft: 'Theft records', flood: 'Flood records', waterDamage: 'Water damage', fire: 'Fire records', totalLoss: 'Total loss', yes: 'Yes', no: 'No' },
  ru: { accidents: 'Сведения о ДТП', transfers: 'Количество переоформлений', owners: 'Количество владельцев', plateChanges: 'Смена номеров', theft: 'Сведения об угоне', flood: 'Затопление', waterDamage: 'Повреждение водой', fire: 'Сведения о пожаре', totalLoss: 'Полная гибель', yes: 'Да', no: 'Нет' },
} satisfies Record<Locale, Record<HistoryKind | 'yes' | 'no', string>>;
const key = (text: string) => text.trim().toLocaleLowerCase('en').replace(/[\s_-]+/gu, '');
const fieldByName = new Map(fields.flatMap((field) => field.aliases.map((name) => [key(name), field] as const)));
const missing = /^(?:unknown|not supplied|not provided|unavailable|n\/?a|null|undefined|未提供|未知|不详|暂无|暂无资料|неизвестно|нет данных|[—–-])$/iu;
const booleanValues: Readonly<Record<string, 'yes' | 'no'>> = { true: 'yes', yes: 'yes', 是: 'yes', 有: 'yes', да: 'yes', false: 'no', no: 'no', 否: 'no', 无: 'no', нет: 'no' };

type ParsedHistory = { field: Field; value: string; token: string; boolean?: 'yes' | 'no'; lang?: string };

function parseEntry(entry: Entry): ParsedHistory | null {
  const field = fieldByName.get(key(entry.name.text));
  const value = entry.value.text.trim();
  if (!field || !value || missing.test(value)) return null;
  // For example, "0 faults / 24 checked" describes inspection coverage, not vehicle history.
  if (/^\d+\s+faults?\s*\/\s*\d+\s+checked$/iu.test(value) || /^\d+\s*\/\s*\d+$/u.test(value)) return null;
  if (/^\d+$/u.test(value)) return { field, value: BigInt(value).toString(), token: `count:${BigInt(value)}`, lang: undefined };
  if (/^[+-]?\d+(?:[.,]\d+)?$/u.test(value)) return null;
  if (field.count) return null;
  const booleanKey = value.toLocaleLowerCase('en');
  const boolean = Object.hasOwn(booleanValues, booleanKey) ? booleanValues[booleanKey] : undefined;
  return { field, value, token: boolean ?? `text:${value}`, boolean, lang: entry.value.contentLocale };
}

export function explicitHistoryEntries(entries: readonly Entry[], locale: Locale) {
  const grouped = new Map<HistoryKind, NonNullable<ReturnType<typeof parseEntry>>[]>();
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (parsed) grouped.set(parsed.field.kind, [...(grouped.get(parsed.field.kind) ?? []), parsed]);
  }
  return [...new Set(fields.map(({ kind }) => kind))].flatMap((kind) => {
    const values = grouped.get(kind);
    // Conflicting records never become a reassuring zero/negative history claim.
    if (!values?.length || new Set(values.map(({ token }) => token)).size !== 1) return [];
    const first = values[0]!;
    return [{ kind, label: labels[locale][kind], value: first.boolean ? labels[locale][first.boolean] : first.value, lang: first.boolean ? locale : first.lang }];
  });
}

export function vehicleHistory(vehicle: Pick<PublicVehicle, 'external'>, locale: Locale) {
  const detail = vehicle.external?.detail;
  const modernHistory = detail !== undefined && Object.hasOwn(detail, 'history');
  const legacy = explicitHistoryEntries([...(detail?.specifications ?? []), ...(detail?.inspection?.entries ?? [])], locale)
    .filter(({ kind }) => !modernHistory || kind !== 'transfers');
  const grouped = new Map(legacy.map((record) => [record.kind, record]));
  const transfers = detail?.history?.ownershipTransfers;
  // An explicit modern null supersedes old text too; only absent history supports legacy fallback.
  if (modernHistory && typeof transfers === 'number' && Number.isInteger(transfers) && transfers >= 0 && transfers <= 100) {
    grouped.set('transfers', { kind: 'transfers', label: labels[locale].transfers, value: String(transfers), lang: undefined });
  }
  return [...new Set(fields.map(({ kind }) => kind))].flatMap((kind) => grouped.get(kind) ?? []);
}
