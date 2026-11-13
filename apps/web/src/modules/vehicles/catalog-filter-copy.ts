import type { Drivetrain } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

type Copy = {
  exportStatus: string;
  exportStatuses: Record<'all' | 'eligible' | 'restricted' | 'unknown', string>;
  sort: string;
  sorts: Record<'newest' | 'price_asc' | 'price_desc' | 'mileage_asc' | 'year_desc', string>;
  search: string;
  generation: string;
  trim: string;
  drive: string;
  price: string;
  mileage: string;
  year: string;
  from: string;
  to: string;
  rangeError: string;
  selected: string;
  drives: Record<Drivetrain, string>;
};
export const catalogFilterCopy = {
  zh: {
    exportStatus: '出口条件', exportStatuses: { all: '全部有效车源', eligible: '符合出口条件', restricted: '出口受限', unknown: '条件待确认' }, sort: '排序', sorts: { newest: '最新发布', price_asc: '价格从低到高', price_desc: '价格从高到低', mileage_asc: '里程从少到多', year_desc: '年款从新到旧' },
    search: '搜索',
    generation: '代次',
    trim: '配置',
    drive: '驱动方式',
    price: '价格',
    mileage: '里程（公里）',
    year: '年款',
    from: '下限',
    to: '上限',
    rangeError: '请检查筛选条件：上限不能低于下限，价格范围需选择币种。',
    selected: '当前所选条件',
    drives: { fwd: '前轮驱动', rwd: '后轮驱动', awd: '全轮驱动', four_wd: '四轮驱动' },
  },
  en: {
    exportStatus: 'Export conditions', exportStatuses: { all: 'All valid listings', eligible: 'Eligible for export', restricted: 'Export restricted', unknown: 'Conditions to confirm' }, sort: 'Sort', sorts: { newest: 'Newest', price_asc: 'Price: low to high', price_desc: 'Price: high to low', mileage_asc: 'Mileage: low to high', year_desc: 'Model year: newest' },
    search: 'Search',
    generation: 'Generation',
    trim: 'Trim',
    drive: 'Drivetrain',
    price: 'Price',
    mileage: 'Mileage (km)',
    year: 'Model year',
    from: 'From',
    to: 'To',
    rangeError:
      'Check the filters: the upper limit must not be below the lower limit. Price ranges require a currency.',
    selected: 'Current selection',
    drives: {
      fwd: 'Front-wheel drive',
      rwd: 'Rear-wheel drive',
      awd: 'All-wheel drive',
      four_wd: 'Four-wheel drive',
    },
  },
  ru: {
    exportStatus: 'Условия экспорта', exportStatuses: { all: 'Все действующие объявления', eligible: 'Экспорт разрешён', restricted: 'Ограничения экспорта', unknown: 'Условия уточняются' }, sort: 'Сортировка', sorts: { newest: 'Сначала новые', price_asc: 'Цена по возрастанию', price_desc: 'Цена по убыванию', mileage_asc: 'Пробег по возрастанию', year_desc: 'Сначала новые годы' },
    search: 'Найти',
    generation: 'Поколение',
    trim: 'Комплектация',
    drive: 'Привод',
    price: 'Цена',
    mileage: 'Пробег (км)',
    year: 'Модельный год',
    from: 'От',
    to: 'До',
    rangeError:
      'Проверьте фильтры: верхняя граница не должна быть ниже нижней. Для диапазона цен выберите валюту.',
    selected: 'Текущее условие',
    drives: {
      fwd: 'Передний привод',
      rwd: 'Задний привод',
      awd: 'Полный привод (AWD)',
      four_wd: 'Полный привод (4WD)',
    },
  },
} satisfies Record<Locale, Copy>;
