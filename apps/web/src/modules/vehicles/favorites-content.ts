import type { Locale } from '@/i18n/routing';

export const favoritesContent = {
  zh: {
    title: '收藏的汽车',
    open: '查看收藏',
    close: '关闭收藏',
    empty: '还没有收藏汽车',
    hint: '点击车辆上的心形按钮，随时回来继续查看。',
    browse: '浏览汽车目录',
    remove: '移除收藏',
    loading: '正在获取车辆信息…',
    missing: '此车辆目前不可用',
    error: '暂时无法获取车辆信息。',
    retry: '重新加载',
    savedOnBrowser: '收藏保存在此浏览器中',
    retryIn: (seconds: number) => `${seconds}秒后可重试`,
  },
  en: {
    title: 'Saved cars',
    open: 'View saved cars',
    close: 'Close saved cars',
    empty: 'No saved cars yet',
    hint: 'Tap the heart on a car and come back to it later.',
    browse: 'Browse the catalog',
    remove: 'Remove saved car',
    loading: 'Loading vehicle information…',
    missing: 'This car is no longer available',
    error: 'Vehicle information is temporarily unavailable.',
    retry: 'Try again',
    savedOnBrowser: 'Saved in this browser',
    retryIn: (seconds: number) => `Try again in ${seconds}s`,
  },
  ru: {
    title: 'Избранные автомобили',
    open: 'Открыть избранное',
    close: 'Закрыть избранное',
    empty: 'Пока нет избранных автомобилей',
    hint: 'Нажмите на сердце на карточке, чтобы вернуться к автомобилю позже.',
    browse: 'Перейти в каталог',
    remove: 'Убрать из избранного',
    loading: 'Загружаем сведения об автомобиле…',
    missing: 'Этот автомобиль больше недоступен',
    error: 'Сведения об автомобиле временно недоступны.',
    retry: 'Повторить',
    savedOnBrowser: 'Сохранено в этом браузере',
    retryIn: (seconds: number) => `Повтор через ${seconds} с`,
  },
} satisfies Record<
  Locale,
  {
    title: string;
    open: string;
    close: string;
    empty: string;
    hint: string;
    browse: string;
    remove: string;
    loading: string;
    missing: string;
    error: string;
    retry: string;
    savedOnBrowser: string;
    retryIn: (seconds: number) => string;
  }
>;
