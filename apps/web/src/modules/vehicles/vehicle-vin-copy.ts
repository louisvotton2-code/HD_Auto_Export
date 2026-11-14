import type { Locale } from '@/i18n/routing';

export const vehicleVinCopy = {
  zh: {
    copy: '复制 VIN',
    copied: 'VIN 已复制',
    failed: '无法复制，请选择号码手动复制。',
  },
  en: {
    copy: 'Copy VIN',
    copied: 'VIN copied',
    failed: 'Unable to copy. Select the number to copy it manually.',
  },
  ru: {
    copy: 'Скопировать VIN',
    copied: 'VIN скопирован',
    failed: 'Не удалось скопировать. Выделите номер и скопируйте его вручную.',
  },
} satisfies Record<Locale, { copy: string; copied: string; failed: string }>;
