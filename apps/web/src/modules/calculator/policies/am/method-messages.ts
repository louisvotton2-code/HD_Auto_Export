import { unifiedMethods } from '../eaeu-method-messages';

export const amMethodMessages = {
  zh: { ...unifiedMethods.zh, officialEnvironmental: '按海关环保税计税价值 {value} AMD 应用车龄档 {rate}%。申报时以海关核定的价值为准。' },
  en: { ...unifiedMethods.en, officialEnvironmental: 'The age band applies {rate}% to an assumed environmental tax base of AMD {value}. Customs confirms the assessed base.' },
  ru: { ...unifiedMethods.ru, officialEnvironmental: 'К предполагаемой базе экологического налога {value} AMD применяется возрастная ставка {rate}%. Базу подтверждает таможня.' },
} as const;
