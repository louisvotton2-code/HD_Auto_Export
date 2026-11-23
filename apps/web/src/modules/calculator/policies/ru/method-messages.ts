import { unifiedMethods } from '../eaeu-method-messages';

export const ruMethodMessages = {
  zh: { ...unifiedMethods.zh, officialClearance: '以申报价值 {value} RUB 查 2026 年清关费分档，适用 {fee} RUB。' },
  en: { ...unifiedMethods.en, officialClearance: 'The 2026 clearance-fee band for an assessed RUB {value} charges RUB {fee}.' },
  ru: { ...unifiedMethods.ru, officialClearance: 'При таможенной стоимости {value} RUB сбор по тарифной шкале 2026 года составляет {fee} RUB.' },
} as const;
