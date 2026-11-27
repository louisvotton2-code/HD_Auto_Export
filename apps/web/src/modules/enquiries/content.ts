import type { Locale } from '@/i18n/routing';

export const enquiryContent = {
  zh: {
    intro: '选择你常用的平台与我们联系。',
    action: '联系团队',
    close: '关闭联系窗口',
  },
  en: {
    intro: 'Choose your preferred platform to get in touch.',
    action: 'Contact our team',
    close: 'Close contact window',
  },
  ru: {
    intro: 'Выберите удобную платформу для связи с нами.',
    action: 'Связаться с командой',
    close: 'Закрыть окно контактов',
  },
} satisfies Record<Locale, Record<string, string>>;
