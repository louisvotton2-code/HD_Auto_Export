import type { ExternalPublicDetail } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

type Entry = ExternalPublicDetail['specifications'][number];

export const equipmentGroups = ['comfort', 'safety', 'technology', 'other'] as const;
type Group = (typeof equipmentGroups)[number];
type Labels = Record<Locale, string>;

const labelIndex = { zh: 1, en: 2, ru: 3 } as const;
const knownFields: Readonly<Partial<Record<string, readonly [Group, string, string, string]>>> = {
  displacementCc: ['technology', '排量（cc）', 'Engine capacity (cc)', 'Объём двигателя (см³)'],
  powerKw: ['technology', '功率（kW）', 'Power (kW)', 'Мощность (кВт)'],
  powerHp: ['technology', '功率（马力）', 'Power (hp)', 'Мощность (л. с.)'],
  torqueNm: ['technology', '扭矩（N·m）', 'Torque (N·m)', 'Крутящий момент (Н·м)'],
  engineKw: ['technology', '发动机功率（kW）', 'Engine power (kW)', 'Мощность двигателя (кВт)'],
  motorKw: ['technology', '电机功率（kW）', 'Motor power (kW)', 'Мощность электромотора (кВт)'],
  systemKw: ['technology', '系统功率（kW）', 'System power (kW)', 'Мощность системы (кВт)'],
  energyType: ['technology', '能源类型', 'Energy type', 'Тип силовой установки'],
  cylinders: ['technology', '气缸数', 'Cylinders', 'Цилиндры'],
  transmissionType: ['technology', '变速箱类型', 'Transmission type', 'Тип коробки передач'],
  gears: ['technology', '挡位数', 'Gears', 'Количество передач'],
  driveType: ['technology', '驱动形式', 'Drive type', 'Тип привода'],
  topSpeedKmh: ['technology', '最高车速（km/h）', 'Top speed (km/h)', 'Максимальная скорость (км/ч)'],
  acceleration0to100S: ['technology', '百公里加速（秒）', '0–100 km/h (s)', 'Разгон 0–100 км/ч (с)'],
  fuelConsumptionL100km: ['technology', '油耗（L/100 km）', 'Fuel consumption (L/100 km)', 'Расход топлива (л/100 км)'],
  batteryKwh: ['technology', '电池容量（kWh）', 'Battery capacity (kWh)', 'Ёмкость батареи (кВт·ч)'],
  batteryType: ['technology', '电池类型', 'Battery type', 'Тип батареи'],
  consumptionKwh100km: ['technology', '电耗（kWh/100 km）', 'Energy consumption (kWh/100 km)', 'Расход энергии (кВт·ч/100 км)'],
  fastChargeHours: ['technology', '快充时间（小时）', 'Fast charging (hours)', 'Быстрая зарядка (ч)'],
  motorLayout: ['technology', '电机布局', 'Motor layout', 'Расположение электромоторов'],
  motorPowerKw: ['technology', '电机功率（kW）', 'Motor power (kW)', 'Мощность электромотора (кВт)'],
  motorTorqueNm: ['technology', '电机扭矩（N·m）', 'Motor torque (N·m)', 'Крутящий момент электромотора (Н·м)'],
  motorType: ['technology', '电机类型', 'Motor type', 'Тип электромотора'],
  motors: ['technology', '电机数量', 'Number of motors', 'Количество электромоторов'],
  rangeKm: ['technology', '续航里程（km）', 'Range (km)', 'Запас хода (км)'],
  slowChargeHours: ['technology', '慢充时间（小时）', 'Slow charging (hours)', 'Медленная зарядка (ч)'],
  seats: ['comfort', '座位数', 'Seats', 'Места'],
  bodyType: ['other', '车身类型', 'Body type', 'Тип кузова'],
  doors: ['other', '车门数', 'Doors', 'Двери'],
  lengthMm: ['other', '车长（mm）', 'Length (mm)', 'Длина (мм)'],
  widthMm: ['other', '车宽（mm）', 'Width (mm)', 'Ширина (мм)'],
  heightMm: ['other', '车高（mm）', 'Height (mm)', 'Высота (мм)'],
  wheelbaseMm: ['other', '轴距（mm）', 'Wheelbase (mm)', 'Колёсная база (мм)'],
  curbWeightKg: ['other', '整备质量（kg）', 'Curb weight (kg)', 'Снаряжённая масса (кг)'],
  grossWeightKg: ['other', '总质量（kg）', 'Gross weight (kg)', 'Полная масса (кг)'],
  fuelTankL: ['other', '油箱容积（L）', 'Fuel tank (L)', 'Топливный бак (л)'],
  trunkL: ['other', '行李厢容积（L）', 'Trunk capacity (L)', 'Объём багажника (л)'],
  emissionStandard: ['other', '排放标准', 'Emission standard', 'Экологический стандарт'],
  launchDate: ['other', '车型上市时间', 'Model launch', 'Выход модели'],
  warranty: ['other', '质保', 'Warranty', 'Гарантия'],
  batteryWarranty: ['other', '电池质保', 'Battery warranty', 'Гарантия на батарею'],
};

const groupLabels = {
  comfort: { zh: '舒适', en: 'Comfort', ru: 'Комфорт' },
  safety: { zh: '安全', en: 'Safety', ru: 'Безопасность' },
  technology: { zh: '技术', en: 'Technology', ru: 'Технологии' },
  other: { zh: '其他', en: 'Other', ru: 'Другое' },
} satisfies Record<Group, Labels>;

const groupPatterns = [
  ['safety', [
    /气囊|安全|碰撞|车道|盲区|胎压|制动|泊车|倒车|儿童锁|儿童座椅(?:接口|固定|锚点)/u,
    /\b(?:abs|esc|tcs|tpms|isofix|airbags?|brak\w+|parking|collision|stability)\b|seat[ -]?belts?|child[ -]seat anchors?|lane departure|rear.view camera|blind.spot/i,
    /безопасност|подушк|парктроник|тормоз|мёртвых зон|крепление детского сиденья/iu,
  ]],
  ['comfort', [
    /座椅|空调|天窗|加热|腰部支撑|隔音|氛围灯|电动窗/u,
    /\b(?:seats?|seating|sunroof|upholstery|lumbar|heated)\b|climate control|air conditioning/i,
    /сидень|климат|подогрев|люк|обивк/iu,
  ]],
  ['technology', [
    /蓝牙|车机|导航|显示屏|中控屏|无线充电|语音控制/u,
    /\b(?:bluetooth|navigation|usb|infotainment|touchscreen|monitor)\b|wireless charging|voice control/i,
    /навигац|мультимедиа|дисплей|блютус/iu,
  ]],
] as const;

function isTransferEntry(entry: Entry) {
  return /^(?:ownership transfers|过户次数|количество переоформлений)$/iu.test(entry.name.text.trim());
}

export function ownershipTransfers(entries: readonly Entry[]) {
  const values = new Set(entries.filter(isTransferEntry).map(({ value }) => value.text.trim()));
  const value = values.values().next().value;
  return values.size === 1 && value !== undefined && /^\d+$/.test(value) ? value : undefined;
}

export function groupVehicleEquipment(entries: readonly Entry[], locale: Locale) {
  const groups: Record<Group, Entry[]> = { comfort: [], safety: [], technology: [], other: [] };
  const transfers = ownershipTransfers(entries);
  for (const entry of entries) {
    if (transfers !== undefined && isTransferEntry(entry)) continue;
    const name = entry.name.text.trim();
    const known = Object.hasOwn(knownFields, name) ? knownFields[name] : undefined;
    const group = known?.[0] ?? groupPatterns.find(([, patterns]) =>
      patterns.some((pattern) => pattern.test(name)),
    )?.[0] ?? 'other';
    groups[group].push(known
      ? { ...entry, name: { ...entry.name, text: known[labelIndex[locale]], contentLocale: locale } }
      : entry);
  }
  return equipmentGroups
    .filter((group) => groups[group].length > 0)
    .map((group) => ({ group, label: groupLabels[group][locale], entries: groups[group] }));
}
