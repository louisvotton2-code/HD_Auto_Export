export const eaeuMethodMessages = {
  zh: {
    unifiedYoung: '个人自用统一税额将车价折合为 {euroValue} EUR，按 {rate}% 得 {percentageDuty} EUR；按 {cc} cc × {minimum} EUR/cc 得 {minimumDuty} EUR，取高者，再按每欧元 {euroRate} 本币换算。',
    unifiedUsed: '个人自用统一税额按实报排量 {cc} cc × 车龄和排量档税率 {rate} 欧元/cc × 本币兑欧元换算系数 {euroRate} 计。',
  },
  en: {
    unifiedYoung: 'The EAEU personal-use charge compares {rate}% of EUR {euroValue} (EUR {percentageDuty}) with {cc} cc at EUR {minimum}/cc (EUR {minimumDuty}). The higher sum is converted at {euroRate} local units per euro.',
    unifiedUsed: 'The EAEU personal-use charge uses {cc} cc at EUR {rate}/cc in the applicable age and displacement band, at {euroRate} local units per euro.',
  },
  ru: {
    unifiedYoung: 'При личном ввозе по единой ставке сравниваются {rate}% от {euroValue} EUR ({percentageDuty} EUR) и {cc} см³ по {minimum} EUR/см³ ({minimumDuty} EUR). Большая сумма пересчитывается по {euroRate} единиц местной валюты за евро.',
    unifiedUsed: 'При личном ввозе {cc} см³ умножаются на ставку {rate} EUR/см³ для возраста и объёма и на курс {euroRate} единиц местной валюты за евро.',
  },
} as const;
