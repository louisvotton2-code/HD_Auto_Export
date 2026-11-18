import type { Drivetrain } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

type Copy = {
  sort: string;
  sorts: Record<'newest' | 'price_asc' | 'price_desc' | 'mileage_asc' | 'year_desc', string>;
  search: string;
  brandSearch: string;
  noBrands: string;
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
  optionsLoading: string;
  drives: Record<Drivetrain, string>;
};
export const catalogFilterCopy = {
  zh: {
    sort: '排序', sorts: { newest: '最新发布', price_asc: '价格从低到高', price_desc: '价格从高到低', mileage_asc: '里程从少到多', year_desc: '年款从新到旧' },
    search: '搜索',
    brandSearch: '搜索品牌',
    noBrands: '没有找到匹配的品牌',
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
    optionsLoading: '正在加载筛选选项…',
    drives: { fwd: '前轮驱动', rwd: '后轮驱动', awd: '全轮驱动', four_wd: '四轮驱动' },
  },
  en: {
    sort: 'Sort', sorts: { newest: 'Newest', price_asc: 'Price: low to high', price_desc: 'Price: high to low', mileage_asc: 'Mileage: low to high', year_desc: 'Model year: newest' },
    search: 'Search',
    brandSearch: 'Search brands',
    noBrands: 'No matching brands',
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
    optionsLoading: 'Loading filter options…',
    drives: {
      fwd: 'Front-wheel drive',
      rwd: 'Rear-wheel drive',
      awd: 'All-wheel drive',
      four_wd: 'Four-wheel drive',
    },
  },
  ru: {
    sort: 'Сортировка', sorts: { newest: 'Сначала новые', price_asc: 'Цена по возрастанию', price_desc: 'Цена по убыванию', mileage_asc: 'Пробег по возрастанию', year_desc: 'Сначала новые годы' },
    search: 'Найти',
    brandSearch: 'Поиск по маркам',
    noBrands: 'Подходящих марок нет',
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
    optionsLoading: 'Загружаем варианты фильтра…',
    drives: {
      fwd: 'Передний привод',
      rwd: 'Задний привод',
      awd: 'Полный привод (AWD)',
      four_wd: 'Полный привод (4WD)',
    },
  },
} satisfies Record<Locale, Copy>;
