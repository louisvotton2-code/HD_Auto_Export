import type { Locale } from '@/i18n/routing';

type HomeCopy = {
  title: [string, string];
  origin: string;
  subtitle: string;
  catalog: string;
  catalogEmpty: string;
  catalogEmptyBody: string;
  catalogUnavailable: string;
  catalogUnavailableBody: string;
  retry: string;
  stats: [string, string, string];
  catalogCountPresetLabel: string;
  yearsSuffix: string;
  scroll: string;
  shortcuts: [string, string, string];
  shortcutNotes: [string, string, string];
  next: string;
  previous: string;
  details: string;
  save: string;
  saved: string;
};

export const homeContent = {
  zh: {
    title: ['下一辆车，', '从中国出发。'],
    origin: '中国 · 成都',
    subtitle: '精选中国车源，协助验车、出口和国际运输。',
    catalog: '汽车目录',
    catalogEmpty: '精选车源正在更新',
    catalogEmptyBody: '欢迎浏览车辆目录，或联系我们沟通你的购车需求。',
    catalogUnavailable: '暂时无法加载精选车源',
    catalogUnavailableBody: '暂时无法获取车辆信息。请稍后重试，或联系我们咨询。',
    retry: '重新加载',
    stats: ['目录中的汽车', '汽车配件', '经营年限'],
    catalogCountPresetLabel: '目录总数暂不可用 · 预设值',
    yearsSuffix: '年',
    scroll: '向下探索',
    shortcuts: ['汽车目录', '汽车配件', '费用计算器'],
    shortcutNotes: ['选择你的理想座驾', '按编号查找所需配件', '预估进口税费'],
    next: '下一组车辆',
    previous: '上一组车辆',
    details: '查看详情',
    save: '收藏车辆',
    saved: '取消收藏车辆',
  },
  en: {
    title: ['Your next car.', 'From China.'],
    origin: 'Chengdu, China',
    subtitle: 'Explore vehicles from China with support for inspection, export and international delivery.',
    catalog: 'Catalog',
    catalogEmpty: 'Our selection is being updated',
    catalogEmptyBody: 'There are no featured listings right now. Browse the catalog or contact us.',
    catalogUnavailable: 'The selection could not be loaded',
    catalogUnavailableBody:
      'Vehicle information is temporarily unavailable. Please try again or contact us for assistance.',
    retry: 'Try again',
    stats: ['Cars in catalog', 'Auto parts', 'On the market'],
    catalogCountPresetLabel: 'Catalog count unavailable · Preset',
    yearsSuffix: ' years',
    scroll: 'Scroll down',
    shortcuts: ['Catalog', 'Auto Parts', 'Customs Calculator'],
    shortcutNotes: ['Find your ideal car', 'Find parts by number', 'Estimate import costs'],
    next: 'Next vehicles',
    previous: 'Previous vehicles',
    details: 'Details',
    save: 'Save listing',
    saved: 'Unsave listing',
  },
  ru: {
    title: ['Ваш автомобиль', 'из Китая.'],
    origin: 'Чэнду, Китай',
    subtitle: 'Подбор автомобилей в Китае, осмотр, оформление экспорта и международная доставка.',
    catalog: 'Каталог автомобилей',
    catalogEmpty: 'Подборка обновляется',
    catalogEmptyBody: 'Посмотрите каталог автомобилей или расскажите нам о своих пожеланиях.',
    catalogUnavailable: 'Не удалось загрузить подборку',
    catalogUnavailableBody:
      'Сведения об автомобилях временно недоступны. Попробуйте ещё раз или свяжитесь с нами.',
    retry: 'Повторить загрузку',
    stats: ['Автомобили в каталоге', 'Автозапчасти', 'На рынке'],
    catalogCountPresetLabel: 'Количество недоступно · Заданное значение',
    yearsSuffix: ' года',
    scroll: 'Листайте вниз',
    shortcuts: ['Каталог авто', 'Запчасти', 'Расчёт ввоза'],
    shortcutNotes: ['Выберите свой автомобиль', 'Поиск запчастей по номеру', 'Расчёт ввоза'],
    next: 'Следующие автомобили',
    previous: 'Предыдущие автомобили',
    details: 'Подробнее',
    save: 'Сохранить автомобиль',
    saved: 'Убрать автомобиль',
  },
} satisfies Record<Locale, HomeCopy>;
