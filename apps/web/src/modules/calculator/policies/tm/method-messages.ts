export const tmMethodMessages = {
  zh: {
    duty: '不计制造年份，当前为 {age} 年档。{value} TMT × {rate}% 与 {cc} cc × {minimum} USD/cc × {usd} TMT/USD，取较高额。',
    hybridDuty: '按 {age} 年档的 {rate}% 从价额和每 cc {minimum} USD 的最低额取高，再按混动优惠的 50% 计征。',
    evDuty: '官方税则第 61 项脚注对符合条件的纯电车免征进口关税。',
    excise: '按内燃机排量 {cc} cc，每 cc 0.30 USD，再以 {usd} TMT/USD 换算。',
    evExcise: '本项目按内燃机排量计税。纯电车辆无内燃机排量，此项为 0。',
    fee: '按个人自用的计税价值 {value} TMT 的 0.2% 计清关费。',
  },
  en: {
    duty: 'The {age}-year band excludes the year of manufacture. Use the higher of {value} TMT × {rate}% and {cc} cc × {minimum} USD/cc × {usd} TMT/USD.',
    hybridDuty: 'For the {age}-year band, take the higher of the {rate}% charge and the {minimum} USD/cc floor, then apply the 50% hybrid reduction.',
    evDuty: 'The footnote to item 61 of the official tariff exempts qualifying battery-electric vehicles from import duty.',
    excise: 'Multiply the internal-combustion displacement of {cc} cc by 0.30 USD/cc and convert at {usd} TMT/USD.',
    evExcise: 'This excise is based on internal-combustion displacement. It is zero for a battery-electric vehicle.',
    fee: 'Apply 0.2% to the personal-use customs value of {value} TMT.',
  },
  ru: {
    duty: 'Для группы {age} лет без учёта года выпуска берётся большее: {value} TMT × {rate}% или {cc} см³ × {minimum} USD/см³ × {usd} TMT/USD.',
    hybridDuty: 'Для группы {age} лет выбирается большее из ставки {rate}% и минимума {minimum} USD/см³, затем сумма уменьшается на 50% для гибрида.',
    evDuty: 'Примечание к позиции 61 тарифов освобождает подходящие электромобили от ввозной пошлины.',
    excise: 'Объём ДВС {cc} см³ умножается на 0,30 USD/см³ и пересчитывается по курсу {usd} TMT/USD.',
    evExcise: 'Акциз зависит от рабочего объёма ДВС. Для электромобиля этот платёж равен нулю.',
    fee: 'Сбор за оформление составляет 0,2% от таможенной стоимости для личного пользования {value} TMT.',
  },
} as const;
