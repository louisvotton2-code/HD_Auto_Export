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
  soon: string;
  soonBody: string;
  close: string;
  contact: string;
};

export const homeContent = {
  zh: {
    title: '寻找你的梦想座驾',
    subtitle: '从中国出发，驶向世界各地！',
    catalog: '浏览车源',
    catalogEmpty: '精选车源正在更新',
    catalogEmptyBody: '欢迎浏览车辆目录，或联系我们沟通你的购车需求。',
    catalogUnavailable: '暂时无法加载精选车源',
    catalogUnavailableBody: '暂时无法获取车辆信息。请稍后重试，或联系我们咨询。',
    retry: '重新加载',
    stats: ['精选车源', '可估算目的地', '服务语言'],
    scroll: '向下探索',
    shortcuts: ['精选车源', '汽车配件', '费用计算器'],
    shortcutNotes: ['选择你的理想座驾', '配件服务即将上线', '预估进口税费'],
    next: '下一组车辆',
    previous: '上一组车辆',
    pause: '暂停自动播放',
    resume: '恢复自动播放',
    details: '查看详情',
    save: '收藏车辆',
    saved: '取消收藏车辆',
    soon: '汽车配件',
    soonBody: '配件服务即将上线，欢迎联系我们咨询选购与运输需求。',
    close: '关闭',
    contact: '联系我们',
  },
  en: {
    title: 'Find the Car of Your Dreams',
    subtitle: 'From China to Anywhere in the World!',
    catalog: 'Browse cars',
    catalogEmpty: 'Our selection is being updated',
    catalogEmptyBody: 'There are no featured listings right now. Browse the catalog or contact us.',
    catalogUnavailable: 'The selection could not be loaded',
    catalogUnavailableBody:
      'Vehicle information is temporarily unavailable. Please try again or contact us for assistance.',
    retry: 'Try again',
    stats: ['Featured listings', 'Estimate destinations', 'Languages'],
    scroll: 'Scroll down',
    shortcuts: ['Browse Cars', 'Auto Parts', 'Customs Calculator'],
    shortcutNotes: ['Find your ideal car', 'Parts coming soon', 'Estimate import costs'],
    next: 'Next vehicles',
    previous: 'Previous vehicles',
    pause: 'Pause autoplay',
    resume: 'Resume autoplay',
    details: 'Details',
    save: 'Save listing',
    saved: 'Unsave listing',
    soon: 'Auto Parts',
    soonBody:
      'Our parts service is coming soon. Contact us about parts and delivery.',
    close: 'Close',
    contact: 'Contact us',
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
    stats: ['На главной', 'Направления для расчёта', 'Языки'],
    scroll: 'Листайте вниз',
    shortcuts: ['Каталог автомобилей', 'Автозапчасти', 'Калькулятор'],
    shortcutNotes: ['Выберите свой автомобиль', 'Скоро в продаже', 'Расчёт ввоза'],
    next: 'Следующие автомобили',
    previous: 'Предыдущие автомобили',
    pause: 'Приостановить автопрокрутку',
    resume: 'Включить автопрокрутку',
    details: 'Подробнее',
    save: 'Сохранить автомобиль',
    saved: 'Убрать автомобиль',
    soon: 'Автозапчасти',
    soonBody:
      'Раздел запчастей скоро откроется. Свяжитесь с нами по вопросам подбора и доставки.',
    close: 'Закрыть',
    contact: 'Связаться с нами',
  },
} satisfies Record<Locale, HomeCopy>;
