import type { Locale } from '@/i18n/routing';

type Copy = {
  loadAll: string;
  loadMore: string;
  reload: string;
  loading: string;
  retry: string;
  retryIn: string;
  error: string;
  changed: string;
  missing: string;
  empty: string;
  count: string;
  loaded: string;
  enableDetails: string;
};

export const configurationSegmentCopy = {
  zh: {
    loadAll: '查看完整配置', loadMore: '继续读取配置', reload: '重新读取配置',
    loading: '正在读取配置…', retry: '重试', retryIn: '{seconds} 秒后可重试',
    error: '暂时无法读取更多配置，请稍后重试。',
    changed: '车辆资料已更新，请重新读取配置。',
    missing: '当前车辆资料已不可用。', empty: '未提供车辆配置。',
    count: '已读取 {loaded} / {total} 项', loaded: '已读取 {loaded} 项',
    enableDetails: '启用 JavaScript 后可继续查看完整配置。',
  },
  en: {
    loadAll: 'View full equipment', loadMore: 'Load more equipment', reload: 'Reload equipment',
    loading: 'Loading equipment…', retry: 'Retry', retryIn: 'Retry in {seconds} seconds',
    error: 'More equipment details are temporarily unavailable. Please try again.',
    changed: 'The vehicle information has changed. Reload the equipment details.',
    missing: 'This vehicle is no longer available.', empty: 'No equipment details provided.',
    count: '{loaded} / {total} items loaded', loaded: '{loaded} items loaded',
    enableDetails: 'Enable JavaScript to continue viewing the full equipment details.',
  },
  ru: {
    loadAll: 'Посмотреть полную комплектацию', loadMore: 'Загрузить ещё характеристики', reload: 'Загрузить комплектацию заново',
    loading: 'Загрузка комплектации…', retry: 'Повторить', retryIn: 'Повторить через {seconds} сек.',
    error: 'Не удалось загрузить дополнительные характеристики. Попробуйте ещё раз.',
    changed: 'Данные автомобиля обновлены. Загрузите комплектацию заново.',
    missing: 'Этот автомобиль больше недоступен.', empty: 'Данные о комплектации не предоставлены.',
    count: 'Загружено {loaded} из {total}', loaded: 'Загружено {loaded} характеристик',
    enableDetails: 'Включите JavaScript, чтобы просмотреть полную комплектацию.',
  },
} satisfies Record<Locale, Copy>;
