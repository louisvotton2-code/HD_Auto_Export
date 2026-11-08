import type { Drivetrain } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

type Copy = {
  search: string;
  generation: string;
  trim: string;
  drive: string;
  price: string;
  mileage: string;
  year: string;
  from: string;
  to: string;
  currency: string;
  rangeError: string;
  selected: string;
  drives: Record<Drivetrain, string>;
};
export const catalogFilterCopy = {
  zh: {
    search: '搜索',
    generation: '代次',
    trim: '配置',
    drive: '驱动方式',
    price: '价格',
    mileage: '里程（公里）',
    year: '年款',
    from: '下限',
    to: '上限',
    currency: '价格币种',
    rangeError: '请检查筛选条件：上限不能低于下限，价格范围需选择币种。',
    selected: '当前所选条件',
    drives: { fwd: '前轮驱动', rwd: '后轮驱动', awd: '全轮驱动', four_wd: '四轮驱动' },
  },
  en: {
    search: 'Search',
    generation: 'Generation',
    trim: 'Trim',
    drive: 'Drivetrain',
    price: 'Price',
    mileage: 'Mileage (km)',
    year: 'Model year',
    from: 'From',
    to: 'To',
    currency: 'Price currency',
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
    search: 'Найти',
    generation: 'Поколение',
    trim: 'Комплектация',
    drive: 'Привод',
    price: 'Цена',
    mileage: 'Пробег (км)',
    year: 'Модельный год',
    from: 'От',
    to: 'До',
    currency: 'Валюта цены',
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
