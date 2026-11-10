import type { Locale } from '@/i18n/routing';

type HomeCopy = {
  title: string;
  subtitle: string;
  catalog: string;
  catalogEmpty: string;
  catalogEmptyBody: string;
  catalogUnavailable: string;
  catalogUnavailableBody: string;
  retry: string;
  stats: [string, string, string];
  yearsSuffix: string;
  scroll: string;
  shortcuts: [string, string, string];
  shortcutNotes: [string, string, string];
  next: string;
  previous: string;
  pause: string;
  resume: string;
  details: string;
  save: string;
  saved: string;
};

export const homeContent = {
  zh: {
    title: '寻找你的梦想座驾',
    subtitle: '从中国出发，驶向世界各地！',
    catalog: '汽车目录',
    catalogEmpty: '精选车源正在更新',
    catalogEmptyBody: '欢迎浏览车辆目录，或联系我们沟通你的购车需求。',
    catalogUnavailable: '暂时无法加载精选车源',
    catalogUnavailableBody: '暂时无法获取车辆信息。请稍后重试，或联系我们咨询。',
    retry: '重新加载',
    stats: ['目录中的汽车', '满意客户', '经营年限'],
    yearsSuffix: '年',
    scroll: '向下探索',
    shortcuts: ['汽车目录', '汽车配件', '费用计算器'],
    shortcutNotes: ['选择你的理想座驾', '按编号查找所需配件', '预估进口税费'],
    next: '下一组车辆',
    previous: '上一组车辆',
    pause: '暂停自动播放',
    resume: '恢复自动播放',
    details: '查看详情',
    save: '收藏车辆',
    saved: '取消收藏车辆',
  },
  en: {
    title: 'Find the Car of Your Dreams',
    subtitle: 'From China to Anywhere in the World!',
    catalog: 'Catalog',
    catalogEmpty: 'Our selection is being updated',
    catalogEmptyBody: 'There are no featured listings right now. Browse the catalog or contact us.',
    catalogUnavailable: 'The selection could not be loaded',
    catalogUnavailableBody:
      'Vehicle information is temporarily unavailable. Please try again or contact us for assistance.',
    retry: 'Try again',
    stats: ['Cars in catalog', 'Happy clients', 'On the market'],
    yearsSuffix: ' years',
    scroll: 'Scroll down',
    shortcuts: ['Catalog', 'Auto Parts', 'Customs Calculator'],
    shortcutNotes: ['Find your ideal car', 'Find parts by number', 'Estimate import costs'],
    next: 'Next vehicles',
    previous: 'Previous vehicles',
    pause: 'Pause autoplay',
    resume: 'Resume autoplay',
    details: 'Details',
    save: 'Save listing',
    saved: 'Unsave listing',
  },
  ru: {
    title: 'Найдите автомобиль своей мечты',
    subtitle: 'Из Китая — в любую точку мира!',
    catalog: 'Каталог автомобилей',
    catalogEmpty: 'Подборка обновляется',
    catalogEmptyBody: 'Посмотрите каталог автомобилей или расскажите нам о своих пожеланиях.',
    catalogUnavailable: 'Не удалось загрузить подборку',
    catalogUnavailableBody:
      'Сведения об автомобилях временно недоступны. Попробуйте ещё раз или свяжитесь с нами.',
    retry: 'Повторить загрузку',
    stats: ['Автомобили в каталоге', 'Довольные клиенты', 'На рынке'],
    yearsSuffix: ' года',
    scroll: 'Листайте вниз',
    shortcuts: ['Каталог автомобилей', 'Автозапчасти', 'Калькулятор'],
    shortcutNotes: ['Выберите свой автомобиль', 'Поиск запчастей по номеру', 'Расчёт ввоза'],
    next: 'Следующие автомобили',
    previous: 'Предыдущие автомобили',
    pause: 'Приостановить автопрокрутку',
    resume: 'Включить автопрокрутку',
    details: 'Подробнее',
    save: 'Сохранить автомобиль',
    saved: 'Убрать автомобиль',
  },
} satisfies Record<Locale, HomeCopy>;
