import type { Locale } from '@/i18n/routing';
import type { PartCategory } from '../types';

type FilterLabel = Record<Locale, string>;
type CatalogCategory = {
  id: string;
  label: FilterLabel;
  count: number;
  recordCategory: PartCategory | null;
};

/**
 * 假数据：以下筛选目录和数量按用户提供的竞品截图写死，仅用于当前页面展示。
 * 后续重构时从配件 API 的 facets 响应替换此文件，不将这些数量当作实际库存、
 * 查询命中数或44条本地资料的分组数量。结果栏继续按真实可浏览资料计数。
 */
export const catalogBrandFilters = [
  { id: 'Hyundai', label: 'Hyundai', count: 48_655 },
  { id: 'Kia', label: 'Kia', count: 32 },
  { id: 'Genesis', label: 'Genesis', count: 2 },
] as const;

export const catalogCategoryFilters: readonly CatalogCategory[] = [
  { id: 'engine', label: { zh: '发动机', en: 'Engine', ru: 'Двигатель' }, count: 14_168, recordCategory: 'components' },
  { id: 'transmission', label: { zh: '传动系统', en: 'Transmission', ru: 'Трансмиссия' }, count: 3_590, recordCategory: 'transmission' },
  { id: 'chassis', label: { zh: '底盘', en: 'Chassis', ru: 'Шасси' }, count: 9_943, recordCategory: 'chassis' },
  { id: 'body', label: { zh: '车身', en: 'Body', ru: 'Кузов' }, count: 1_174, recordCategory: 'body' },
  { id: 'interior', label: { zh: '内饰', en: 'Interior', ru: 'Салон' }, count: 19_814, recordCategory: null },
  { id: 'hardware', label: { zh: '紧固件与五金', en: 'Fasteners & Hardware', ru: 'Крепёж и метизы' }, count: 0, recordCategory: null },
];

/** Static navigation taxonomy from the reference; terms only match known record names. */
export const catalogSubcategoryFilters = [
  { id: 'oil-filters', category: 'engine', label: { zh: '机油与滤清器', en: 'Oil & Filters', ru: 'Масло и фильтры' }, terms: ['oil', 'filter'] },
  { id: 'engine-mounts', category: 'engine', label: { zh: '发动机与变速箱支架', en: 'Engine & Transmission Mounts', ru: 'Опоры двигателя и КПП' }, terms: ['mount'] },
  { id: 'cooling', category: 'engine', label: { zh: '冷却系统', en: 'Cooling System', ru: 'Система охлаждения' }, terms: ['cooling', 'radiator'] },
  { id: 'belts', category: 'engine', label: { zh: '皮带、皮带轮与张紧器', en: 'Belts, Pulleys & Tensioners', ru: 'Ремни, шкивы и натяжители' }, terms: ['belt', 'pulley', 'tensioner'] },
  { id: 'ignition', category: 'engine', label: { zh: '点火系统', en: 'Ignition System', ru: 'Система зажигания' }, terms: ['ignition', 'spark'] },
  { id: 'sensors', category: 'engine', label: { zh: '传感器', en: 'Sensors', ru: 'Датчики' }, terms: ['sensor'] },
  { id: 'fuel', category: 'engine', label: { zh: '燃油系统', en: 'Fuel System', ru: 'Топливная система' }, terms: ['fuel'] },
  { id: 'intake', category: 'engine', label: { zh: '进气系统', en: 'Intake & Exhaust', ru: 'Впуск и выпуск' }, terms: ['intake', 'exhaust'] },
  { id: 'valves', category: 'engine', label: { zh: '气门与密封件', en: 'Valves & Seals', ru: 'Клапаны и уплотнения' }, terms: ['valve', 'cvvd', 'seal'] },
  { id: 'exhaust', category: 'engine', label: { zh: '排气系统', en: 'Exhaust System', ru: 'Выхлопная система' }, terms: ['exhaust'] },
  { id: 'turbocharger', category: 'engine', label: { zh: '涡轮增压系统', en: 'Turbocharger System', ru: 'Турбонаддув' }, terms: ['turbo'] },
  { id: 'starter', category: 'engine', label: { zh: '起动机与发电机', en: 'Starter & Alternator', ru: 'Стартер и генератор' }, terms: ['starter', 'alternator'] },
  { id: 'air-conditioning', category: 'engine', label: { zh: '空调系统', en: 'A/C System', ru: 'Кондиционер' }, terms: ['air conditioning', 'compressor'] },
  { id: 'hoses', category: 'engine', label: { zh: '发动机软管与管路', en: 'Engine Hoses & Pipes', ru: 'Шланги и патрубки' }, terms: ['hose', 'pipe'] },
  { id: 'electronics', category: 'engine', label: { zh: '发动机电气', en: 'Engine Electronics', ru: 'Электроника двигателя' }, terms: ['connector', 'ket_', 'ket ', 'kum '] },
  { id: 'automatic-transmission', category: 'transmission', label: { zh: '自动变速箱', en: 'Automatic Transmission', ru: 'Автоматическая КПП' }, terms: ['gear', 'transmission'] },
  { id: 'clutch', category: 'transmission', label: { zh: '离合器', en: 'Clutch', ru: 'Сцепление' }, terms: ['clutch'] },
  { id: 'brakes', category: 'chassis', label: { zh: '制动系统', en: 'Brakes', ru: 'Тормозная система' }, terms: ['brake', 'abs'] },
  { id: 'suspension', category: 'chassis', label: { zh: '悬架', en: 'Suspension', ru: 'Подвеска' }, terms: ['suspension', 'spring', 'shock'] },
  { id: 'steering', category: 'chassis', label: { zh: '转向系统', en: 'Steering', ru: 'Рулевое управление' }, terms: ['steering'] },
  { id: 'hub-bearings', category: 'chassis', label: { zh: '轮毂与轴承', en: 'Hub & Bearings', ru: 'Ступицы и подшипники' }, terms: ['wheel', 'hub', 'bearing'] },
  { id: 'drive-shafts', category: 'chassis', label: { zh: '传动轴', en: 'Drive Shafts', ru: 'Приводные валы' }, terms: ['shaft'] },
] as const;
