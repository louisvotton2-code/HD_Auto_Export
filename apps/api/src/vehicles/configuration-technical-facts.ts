import {
  CONFIGURATION_IMPORT_LOCALES, VehicleFactsSchema, type ConfigurationImportItem, type VehicleDetailMatchKey,
} from '@hd/contracts/admin';

type Locale = typeof CONFIGURATION_IMPORT_LOCALES[number];
type LocaleTexts = Record<Locale, string>;
type CandidatePosition = { index: number; id: string; key: VehicleDetailMatchKey };
type Candidate = CandidatePosition & { value: number | string | LocaleTexts };
type UnusableCandidate = CandidatePosition & { reason: 'unverified' | 'conflict' };
type MeasurementUnit = 'displacement' | 'kilowatts' | 'horsepower';
type EnumKey = 'bodyType' | 'driveType' | 'transmissionType' | 'energyType';
type EnumAliases = Record<string, Partial<Record<Locale, readonly string[]>>>;

const normalized = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
const normalizedName = (name: string) => normalized(name).replace(/\s*\(\s*/gu, '(').replace(/\s*\)$/u, ')');

const sourceKeys = new Map<string, VehicleDetailMatchKey>([
  ['排量(cc)', 'displacementCc'], ['发动机排量(cc)', 'displacementCc'],
  ['排量(cm3)', 'displacementCc'], ['发动机排量(cm3)', 'displacementCc'],
  ['原始马力(hp)', 'powerHp'], ['原始功率(hp)', 'powerHp'],
  ['发动机最大功率(kw)', 'engineKw'], ['发动机功率(kw)', 'engineKw'],
  ['电动机最大功率(kw)', 'motorKw'], ['电机最大功率(kw)', 'motorKw'],
  ['电动机功率(kw)', 'motorKw'], ['电机功率(kw)', 'motorKw'],
  ['系统综合功率(kw)', 'systemKw'], ['系统最大功率(kw)', 'systemKw'], ['系统功率(kw)', 'systemKw'],
  ['发动机最大功率(hp)', 'engineHp'], ['发动机功率(hp)', 'engineHp'],
  ['发动机最大马力(hp)', 'engineHp'], ['发动机马力(hp)', 'engineHp'],
  ['电动机最大功率(hp)', 'motorHp'], ['电机最大功率(hp)', 'motorHp'],
  ['电动机功率(hp)', 'motorHp'], ['电机功率(hp)', 'motorHp'],
  ['电动机最大马力(hp)', 'motorHp'], ['电机最大马力(hp)', 'motorHp'],
  ['电动机马力(hp)', 'motorHp'], ['电机马力(hp)', 'motorHp'],
  ['系统综合功率(hp)', 'systemHp'], ['系统最大功率(hp)', 'systemHp'], ['系统功率(hp)', 'systemHp'],
  ['系统综合马力(hp)', 'systemHp'], ['系统最大马力(hp)', 'systemHp'], ['系统马力(hp)', 'systemHp'],
  ['功率(kw)', 'powerKw'],
  ['车身形式', 'bodyType'], ['车身类型', 'bodyType'], ['变速箱', 'transmissionType'],
  ['驱动形式', 'driveType'], ['驱动方式', 'driveType'],
  ['车身级别', 'vehicleClass'], ['车型级别', 'vehicleClass'], ['动力类型', 'energyType'],
]);

const units = new Map<string, MeasurementUnit>([
  ['cc', 'displacement'], ['cm3', 'displacement'], ['см3', 'displacement'],
  ['kw', 'kilowatts'], ['квт', 'kilowatts'],
  ['hp', 'horsepower'],
]);

function measurementUnit(key: VehicleDetailMatchKey): MeasurementUnit | null {
  if (key === 'displacementCc') return 'displacement';
  if (key === 'powerKw' || key === 'engineKw' || key === 'motorKw' || key === 'systemKw') return 'kilowatts';
  if (key === 'powerHp' || key === 'engineHp' || key === 'motorHp' || key === 'systemHp') return 'horsepower';
  return null;
}

const enumAliases: Record<EnumKey, EnumAliases> = {
  bodyType: {
    hatchback: { zh: ['掀背'], en: ['hatchback'], ru: ['хэтчбек'] },
    suv: { zh: ['suv'], en: ['suv'], ru: ['suv', 'внедорожник'] },
    sedan: { zh: ['轿车'], en: ['sedan', 'saloon'], ru: ['седан'] },
    wagon: { zh: ['旅行车'], en: ['wagon', 'station wagon', 'estate'], ru: ['универсал'] },
    coupe: { zh: ['轿跑'], en: ['coupe', 'coupé'], ru: ['купе'] },
    convertible: { zh: ['敞篷'], en: ['convertible', 'cabriolet'], ru: ['кабриолет'] },
    van: { zh: ['厢式车'], en: ['van'], ru: ['фургон'] },
    pickup: { zh: ['皮卡'], en: ['pickup', 'pick-up'], ru: ['пикап'] },
    other: { zh: ['其他'], en: ['other'], ru: ['другой', 'другое'] },
  },
  transmissionType: {
    manual: { zh: ['手动'], en: ['manual', 'manual transmission'], ru: ['механическая', 'механическая коробка передач', 'мкпп'] },
    automatic: { zh: ['自动'], en: ['automatic', 'automatic transmission'], ru: ['автоматическая', 'автоматическая коробка передач', 'акпп'] },
    cvt: { zh: ['无级变速'], en: ['cvt', 'continuously variable transmission'], ru: ['cvt', 'вариатор'] },
    dct: { zh: ['双离合'], en: ['dct', 'dual clutch', 'dual-clutch transmission'], ru: ['dct', 'двойное сцепление', 'коробка передач с двойным сцеплением'] },
    other: { zh: ['其他'], en: ['other'], ru: ['другая', 'другое'] },
  },
  driveType: {
    fwd: { zh: ['前驱', '前轮驱动', 'fwd'], en: ['fwd', 'front-wheel drive', 'front wheel drive'], ru: ['fwd', 'передний привод'] },
    rwd: { zh: ['后驱', '后轮驱动', 'rwd'], en: ['rwd', 'rear-wheel drive', 'rear wheel drive'], ru: ['rwd', 'задний привод'] },
    awd: { zh: ['全轮驱动', 'awd'], en: ['awd', 'all-wheel drive', 'all wheel drive'], ru: ['awd', 'привод на все колёса', 'привод на все колеса'] },
    four_wd: { zh: ['四轮驱动', '4wd'], en: ['4wd', 'four-wheel drive', 'four wheel drive'], ru: ['4wd', 'привод на четыре колеса'] },
  },
  energyType: {
    petrol: { zh: ['汽油'], en: ['petrol', 'gasoline'], ru: ['бензин', 'бензиновый'] },
    diesel: { zh: ['柴油'], en: ['diesel'], ru: ['дизель', 'дизельный'] },
    hev: { zh: ['油电混动'], en: ['hev', 'hybrid electric', 'hybrid electric vehicle'], ru: ['hev', 'гибрид без подзарядки'] },
    phev: { zh: ['插电混动'], en: ['phev', 'plug-in hybrid', 'plug-in hybrid electric vehicle'], ru: ['phev', 'подключаемый гибрид'] },
    erev: { zh: ['增程'], en: ['erev', 'range extender', 'extended-range electric vehicle'], ru: ['erev', 'электромобиль с увеличенным запасом хода'] },
    bev: { zh: ['纯电'], en: ['bev', 'electric', 'battery electric vehicle'], ru: ['bev', 'электромобиль', 'электрический'] },
    lpg: { zh: ['液化石油气'], en: ['lpg', 'liquefied petroleum gas'], ru: ['lpg', 'сжиженный нефтяной газ'] },
    other: { zh: ['其他'], en: ['other'], ru: ['другой', 'другое'] },
  },
};

function isEnumKey(key: VehicleDetailMatchKey): key is EnumKey {
  return key === 'bodyType' || key === 'transmissionType' || key === 'driveType' || key === 'energyType';
}

function enumValue(key: EnumKey, value: string, locale: Locale) {
  const text = normalized(value);
  return Object.entries(enumAliases[key]).find(([, aliases]) => aliases[locale]?.includes(text))?.[0] ?? null;
}

const unknownClass = new Set(['未知', '暂无', '未提供', '不适用', '其他', '无', '待确认', '无资料', '待补充', 'unknown', 'unspecified', 'other',
  'not available', 'not applicable', 'неизвестно', 'нет данных', 'не указано', 'n/a', 'na', '-', '—', '0']);
function classValue(value: string) {
  const trimmed = value.trim();
  return trimmed.length <= 120 && /[\p{L}\p{N}]/u.test(trimmed) && !unknownClass.has(normalized(trimmed)) ? trimmed : null;
}

const unitSuffix = /\(([^()]*)\)$/u;
const unsupportedUnits = new Set(['ps', 'cv', 'bhp', 'л.с.', 'л. с.', 'лс', 'l', 'л', 'liter', 'litre', '升']);
function unitInName(name: string) {
  const suffix = unitSuffix.exec(normalizedName(name));
  if (!suffix) return undefined;
  const unit = suffix[1]!;
  return units.get(unit) ?? (unsupportedUnits.has(unit) ? 'unsupported' : undefined);
}

function powerScope(name: string) {
  const label = normalized(name);
  if (/电动机|电机|\b(?:electric motor|motor)\b|электродвигател|электромотор/u.test(label)) return 'motor';
  if (/发动机|\b(?:engine|combustion)\b|двигател/u.test(label)) return 'engine';
  if (/系统|\bsystem\b|\bcombined\b|систем|суммарн/u.test(label)) return 'system';
  return null;
}

function canonicalDecimal(value: string) {
  const [mantissa, exponent] = value.split('e');
  const [whole, fraction = ''] = mantissa!.split('.');
  const digits = whole! + fraction;
  const point = whole!.length + Number(exponent ?? 0);
  const integer = (point <= 0 ? '' : digits.slice(0, point).padEnd(point, '0')).replace(/^0+/u, '') || '0';
  const decimal = (point <= 0 ? '0'.repeat(-point) + digits : digits.slice(point)).replace(/0+$/u, '');
  return decimal ? `${integer}.${decimal}` : integer;
}

function measurementValue(key: VehicleDetailMatchKey, name: string, value: string, inNameOnly: boolean) {
  const expected = measurementUnit(key);
  const number = /^(\d+(?:\.\d+)?)(?:\s*([a-zа-я0-9³]+))?$/iu.exec(value.trim());
  if (!expected || !number) return null;
  const namedUnit = unitInName(name);
  const statedUnit = number[2] ? units.get(normalized(number[2])) ?? null : undefined;
  if (namedUnit !== undefined && namedUnit !== expected) return null;
  if (statedUnit !== undefined && (inNameOnly || statedUnit !== expected)) return null;
  if (namedUnit !== expected && statedUnit !== expected) return null;
  const scope = powerScope(name);
  if (scope && expected !== 'displacement' && !key.startsWith(scope)) return null;
  if (!inNameOnly && !scope && expected !== 'displacement' && key !== 'powerKw' && key !== 'powerHp') return null;
  const parsed = Number(number[1]);
  const schema = expected === 'displacement' ? VehicleFactsSchema.shape.engineCc : VehicleFactsSchema.shape.powerKw;
  return schema.safeParse(parsed).success && canonicalDecimal(number[1]!) === canonicalDecimal(String(parsed)) ? parsed : null;
}

/** The original configuration label determines its semantic key. */
export function configurationTechnicalKey(name: string): VehicleDetailMatchKey | null {
  return sourceKeys.get(normalizedName(name)) ?? null;
}

const localizedMatchNames: Partial<Record<VehicleDetailMatchKey, Record<'en' | 'ru', readonly string[]>>> = {
  displacementCc: { en: ['displacement', 'engine displacement', 'engine capacity'], ru: ['рабочий объём', 'рабочий объем', 'объём двигателя', 'объем двигателя'] },
  powerKw: { en: ['power'], ru: ['мощность'] },
  powerHp: { en: ['original power', 'original horsepower', 'source-reported horsepower'], ru: ['исходная мощность', 'исходная мощность в hp'] },
  engineKw: { en: ['engine power', 'maximum engine power', 'engine maximum power'], ru: ['мощность двигателя', 'максимальная мощность двигателя'] },
  motorKw: { en: ['motor power', 'electric motor power', 'maximum motor power', 'maximum electric motor power'], ru: ['мощность электродвигателя', 'максимальная мощность электродвигателя', 'мощность электромотора'] },
  systemKw: { en: ['system power', 'combined system power', 'total system power', 'maximum system power'], ru: ['мощность системы', 'суммарная мощность системы', 'максимальная мощность системы'] },
  engineHp: { en: ['engine power', 'maximum engine power', 'engine horsepower'], ru: ['мощность двигателя', 'максимальная мощность двигателя'] },
  motorHp: { en: ['motor power', 'electric motor power', 'motor horsepower'], ru: ['мощность электродвигателя', 'максимальная мощность электродвигателя', 'мощность электромотора'] },
  systemHp: { en: ['system power', 'combined system power', 'system horsepower'], ru: ['мощность системы', 'суммарная мощность системы', 'максимальная мощность системы'] },
  bodyType: { en: ['body type', 'body style'], ru: ['тип кузова', 'кузов'] },
  transmissionType: { en: ['transmission', 'gearbox'], ru: ['коробка передач', 'трансмиссия'] },
  driveType: { en: ['drive', 'drive type', 'drivetrain'], ru: ['привод', 'тип привода'] },
  vehicleClass: { en: ['vehicle class', 'car class', 'body class'], ru: ['класс автомобиля', 'класс кузова'] },
  energyType: { en: ['powertrain', 'powertrain type', 'fuel type', 'energy type'], ru: ['тип силовой установки', 'тип топлива', 'тип двигателя'] },
};

/** Compare a localized configuration value to the scalar actually used in vehicle details. */
export function configurationTechnicalValue(key: VehicleDetailMatchKey, name: string, value: string, locale: Locale): number | string | null {
  if (locale === 'zh') {
    if (configurationTechnicalKey(name) !== key) return null;
  } else {
    const aliases = localizedMatchNames[key]?.[locale];
    const label = normalizedName(name).replace(unitSuffix, '').trim();
    if (aliases && !aliases.includes(label)) return null;
  }
  if (key === 'vehicleClass') return classValue(value);
  if (isEnumKey(key)) return enumValue(key, value, locale);
  return measurementValue(key, name, value, false);
}

/** Supplier field identity is already proved by the canonical segment ID. */
export function supplierTechnicalMeasurement(key: VehicleDetailMatchKey, name: string, value: string) {
  return measurementValue(key, name, value, false);
}

export function supplierTechnicalEnum(key: VehicleDetailMatchKey, value: string, locale: Locale) {
  return isEnumKey(key) ? enumValue(key, value, locale) : null;
}

export function configurationTechnicalCandidates(items: readonly ConfigurationImportItem[]): {
  candidates: Candidate[]; invalid: UnusableCandidate[];
} {
  const candidates: Candidate[] = [];
  const invalid: UnusableCandidate[] = [];
  for (const [index, item] of items.entries()) {
    const key = configurationTechnicalKey(item.name.zh);
    if (!key || key === 'powerKw') continue;
    const position = { index, id: item.id, key };
    let value: Candidate['value'] | null;
    let reason: UnusableCandidate['reason'] = 'unverified';
    if (key === 'vehicleClass') {
      const zh = classValue(item.value.zh), en = classValue(item.value.en), ru = classValue(item.value.ru);
      value = zh && en && ru ? { zh, en, ru } : null;
    } else if (isEnumKey(key)) {
      const chinese = enumValue(key, item.value.zh, 'zh');
      const translated = (['en', 'ru'] as const).map(locale => enumValue(key, item.value[locale], locale));
      if (chinese !== null && translated.some(entry => entry !== null && entry !== chinese)) reason = 'conflict';
      value = reason === 'conflict' || translated.includes(null) ? null : chinese;
    } else {
      const chinese = measurementValue(key, item.name.zh, item.value.zh, true);
      value = CONFIGURATION_IMPORT_LOCALES.every(locale => measurementValue(key, item.name[locale], item.value[locale], true) === chinese)
        ? chinese : null;
    }
    if (value === null) invalid.push({ ...position, reason });
    else candidates.push({ ...position, value });
  }
  return { candidates, invalid };
}
