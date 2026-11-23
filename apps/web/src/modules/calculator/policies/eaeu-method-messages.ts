export const unifiedMethods = {
  zh: {
    unifiedYoung: '个人自用统一税额按车辆价值的 {rate}% 与 {cc} cc × {minimum} 欧元/cc 取高值，按 {euroRate} 的本币兑欧元换算系数折回本币。',
    unifiedUsed: '个人自用统一税额按实报排量 {cc} cc × 车龄和排量档税率 {rate} 欧元/cc × 本币兑欧元换算系数 {euroRate} 计。',
  },
  en: {
    unifiedYoung: 'The EAEU personal-use charge uses the higher of {rate}% of value and {cc} cc at EUR {minimum}/cc, then converts at {euroRate} local units per euro.',
    unifiedUsed: 'The EAEU personal-use charge uses {cc} cc at EUR {rate}/cc in the applicable age and displacement band, at {euroRate} local units per euro.',
  },
  ru: {
    unifiedYoung: 'При личном ввозе по единой ставке берётся большее из {rate}% стоимости и {cc} см³ по {minimum} EUR/см³ с пересчётом по {euroRate} единиц местной валюты за евро.',
    unifiedUsed: 'При личном ввозе {cc} см³ умножаются на ставку {rate} EUR/см³ для возраста и объёма и на курс {euroRate} единиц местной валюты за евро.',
  },
} as const;
