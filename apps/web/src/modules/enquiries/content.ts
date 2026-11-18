import type { Locale } from '@/i18n/routing';

export const enquiryContent = {
  zh: {
    intro: '选择你常用的平台与我们联系。',
    close: '关闭联系窗口',
  },
  en: {
    intro: 'Choose your preferred platform to get in touch.',
    close: 'Close contact window',
  },
  ru: {
    intro: 'Выберите удобную платформу для связи с нами.',
    close: 'Закрыть окно контактов',
  },
} satisfies Record<Locale, Record<string, string>>;
