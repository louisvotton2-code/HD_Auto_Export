import { PartialDateSchema, type DisplayText, type ExternalIssue, type PublicVehicleInline } from '@hd/contracts/public';
import { hasPrivateVehicleSource } from '@/shared/lib/public-vehicle-reference';
import type { Locale } from '@/i18n/routing';
import type { VehicleFactId, VehicleFactRow } from './public-presentation';

type Match = NonNullable<PublicVehicleInline['technicalDetails']>['configurationMatches'][number];
type ConfigItem = { id: string; name: DisplayText; value: DisplayText };
type DetailConfigItem = ConfigItem & { semanticKey?: string | null };
export type ConfigurationFact = {
  value: string | number;
  name: DisplayText;
  field: DisplayText;
  itemIds: string[];
};

const factIds = {
  displacementCc: 'displacementCc',
  powerKw: 'powerKw',
  powerHp: 'powerHp',
  engineKw: 'engineKw',
  motorKw: 'motorKw',
  systemKw: 'systemKw',
  engineHp: 'engineHp',
  motorHp: 'motorHp',
  systemHp: 'systemHp',
  bodyType: 'body',
  transmissionType: 'transmission',
  driveType: 'drivetrain',
  vehicleClass: 'vehicleClass',
  energyType: 'powertrain',
} satisfies Record<Match['semanticKey'], VehicleFactId>;

const normalize = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
const labels: Partial<Record<VehicleFactId, readonly string[]>> = {
  modelYear: ['年款', '车型年款', 'model year', 'модельный год'],
  manufacturedAt: ['制造时间', '生产时间', '生产日期', '制造日期', 'manufacture date', 'production date', 'date of manufacture', 'дата производства', 'дата выпуска'],
  firstRegistration: ['首次登记', '首次登记时间', '首次上牌时间', '首次登记日期', 'first registration', 'first registration date', 'date of first registration', 'первая регистрация', 'дата первой регистрации'],
  mileageKm: ['里程', '行驶里程', '表显里程', 'mileage', 'odometer', 'пробег'],
  powertrain: ['动力类型', '能源类型', 'powertrain type', 'powertrain', 'energy type', 'fuel type', 'тип силовой установки', 'тип энергии', 'тип топлива'],
  trim: ['款型', '车型款型', '车型版本', 'trim', 'trim level', 'комплектация'],
  drivetrain: ['驱动方式', '驱动形式', 'drive', 'drive type', 'drivetrain', 'drive configuration', 'тип привода', 'привод'],
  displacementCc: ['排量', '发动机排量', 'engine displacement', 'engine capacity', 'displacement', 'объём двигателя', 'объем двигателя', 'рабочий объём'],
  powerKw: ['功率', 'power', 'мощность'],
  powerHp: ['原始马力', '原始功率', 'original horsepower', 'source-reported horsepower', 'original power', 'исходная мощность'],
  engineKw: ['发动机功率', '发动机最大功率', 'engine power', 'maximum engine power', 'мощность двигателя', 'максимальная мощность двигателя'],
  engineHp: ['发动机马力', '发动机最大马力', 'engine horsepower', 'мощность двигателя'],
  motorKw: ['电机功率', '电动机功率', '电机最大功率', '电动机最大功率', '电动机总功率', 'motor power', 'electric motor power', 'total traction motor power', 'мощность электромотора', 'мощность электродвигателя', 'суммарная мощность тяговых электродвигателей'],
  motorHp: ['电机马力', '电动机马力', 'motor horsepower', 'мощность электромотора'],
  systemKw: ['系统功率', '系统综合功率', '系统最大功率', 'system power', 'combined system power', 'combined powertrain output', 'мощность системы', 'суммарная мощность системы', 'суммарная мощность силовой установки'],
  systemHp: ['系统马力', '系统综合马力', 'system horsepower', 'суммарная мощность системы'],
  body: ['车身形式', '车身类型', 'body type', 'body style', 'тип кузова'],
  transmission: ['变速箱', 'transmission', 'gearbox', 'коробка передач', 'трансмиссия'],
  location: ['车辆所在地', '所在地', 'vehicle location', 'location', 'местонахождение автомобиля', 'местонахождение'],
  vehicleClass: ['车身级别', '车型级别', 'vehicle class', 'car class', 'body class', 'класс автомобиля', 'класс кузова'],
};

const units: Partial<Record<VehicleFactId, readonly string[]>> = {
  mileageKm: ['km', 'км', '公里', '千米'],
  displacementCc: ['cc', 'cm3', 'см3', 'куб. см'],
  powerKw: ['kw', 'квт'], engineKw: ['kw', 'квт'], motorKw: ['kw', 'квт'], systemKw: ['kw', 'квт'],
  powerHp: ['hp'], engineHp: ['hp'], motorHp: ['hp'], systemHp: ['hp'],
};
const placeholder = /^(?:[-–—/?]+|unknown|unspecified|not (?:available|applicable|provided|specified)|n\/?a|none|other|tbd|awaiting translation|未知|暂无|未提供|未填写|不适用|其他|待确认|待翻译|неизвестно|нет (?:данных|сведений)|не указано|другое)$/iu;

function exactDate(text: string): string | null {
  const precision = text.length === 4 ? 'year' : text.length === 7 ? 'month' : 'day';
  const result = PartialDateSchema.safeParse({ precision, value: text });
  return result.success ? result.data.value : null;
}

function configurationValue(id: VehicleFactId, text: string, labelUnit: string | undefined) {
  const expectedUnits = units[id];
  if (expectedUnits) {
    const measurement = /^(\d+(?:\.\d{1,8})?)\s*([^\d\s].*)?$/u.exec(normalize(text));
    if (!measurement) return undefined;
    const valueUnit = measurement[2];
    if ((!labelUnit && !valueUnit) || (labelUnit && !expectedUnits.includes(labelUnit)) ||
      (valueUnit && !expectedUnits.includes(valueUnit))) return undefined;
    const value = Number(measurement[1]);
    const limit = id === 'mileageKm' ? 10_000_000 : 100_000;
    if (value > limit || (id === 'mileageKm' || id === 'displacementCc') && !Number.isInteger(value)) return undefined;
    return value;
  }
  if (labelUnit) return undefined;
  if (id === 'modelYear') {
    return /^\d{4}$/u.test(text) && Number(text) >= 1886 ? Number(text) : undefined;
  }
  if (id === 'manufacturedAt' || id === 'firstRegistration') {
    const date = exactDate(text);
    if (date || id === 'firstRegistration') return date ?? undefined;
    const range = text.split(/\s+[–—-]\s+|\s*至\s*/u);
    if (range.length !== 2) return undefined;
    const start = exactDate(range[0]!);
    const end = exactDate(range[1]!);
    return start && end && start <= end ? `${start} – ${end}` : undefined;
  }
  return /\p{L}/u.test(text) && !placeholder.test(text) ? text : undefined;
}

function sameDisplayText(a: DisplayText, b: DisplayText) {
  return a.text === b.text && a.contentLocale === b.contentLocale &&
    a.provenance === b.provenance && a.reviewed === b.reviewed;
}

/** Promote only a complete, unambiguous row from the already authorized detail projection. */
export function configurationFacts(items: readonly DetailConfigItem[], locale: Locale, issues: readonly ExternalIssue[] = []) {
  const facts = new Map<VehicleFactId, ConfigurationFact | null>();
  const disputed = new Set<string>(issues.filter(({ code }) => code === 'conflict' || code === 'invalid')
    .map(({ field }) => field === 'engineCc' ? 'displacementCc' : field));
  if (disputed.has('specifications')) return facts;
  for (const item of items) {
    const { name, value: field } = item;
    if (name.status !== 'ready' || field.status !== 'ready' ||
      name.requestedLocale !== locale || field.requestedLocale !== locale) continue;
    const text = field.text.trim();
    if (!text || text.length > 200 || hasPrivateVehicleSource(text) || /https?:\/\//iu.test(text)) continue;
    const label = normalize(name.text);
    const suffix = /\s*\(\s*([^()]*)\s*\)$/u.exec(label);
    const baseLabel = suffix ? label.slice(0, suffix.index) : label;
    const labelUnit = suffix?.[1]?.trim();
    const matches = Object.entries(labels).flatMap(([key, aliases]) => {
      const id = key as VehicleFactId;
      if (!aliases.includes(baseLabel)) return [];
      const value = configurationValue(id, text, labelUnit);
      return value === undefined ? [] : [{ id, value }];
    });
    if (matches.length !== 1) continue;
    const { id, value } = matches[0]!;
    if (disputed.has(id)) continue;
    if (item.semanticKey && (!Object.hasOwn(factIds, item.semanticKey) ||
      factIds[item.semanticKey as Match['semanticKey']] !== id)) continue;
    const current = facts.get(id);
    if (current === null) continue;
    if (!current) facts.set(id, { value, name, field, itemIds: [item.id] });
    else if (current.value !== value || current.field.contentLocale !== field.contentLocale) facts.set(id, null);
    else if (sameDisplayText(current.name, name) && sameDisplayText(current.field, field))
      current.itemIds.push(item.id);
  }
  return facts;
}

/** Hide only explicitly moved rows and BE-confirmed duplicates of facts visible in this locale. */
export function configurationWithoutShownFacts<T extends ConfigItem>(
  items: readonly T[],
  facts: readonly VehicleFactRow[],
  matches: readonly Match[] = [],
): T[] {
  const visibleFacts = new Set(facts.filter(fact => !fact.configuration).map(fact => fact.id));
  const hidden = new Set(matches.filter(match => visibleFacts.has(factIds[match.semanticKey]))
    .map(match => match.id));
  for (const fact of facts) for (const id of fact.configuration?.itemIds ?? []) hidden.add(id);
  return items.filter(item => !hidden.has(item.id)
    || item.name.status !== 'ready' || !item.name.text.trim()
    || item.value.status !== 'ready' || !item.value.text.trim());
}
