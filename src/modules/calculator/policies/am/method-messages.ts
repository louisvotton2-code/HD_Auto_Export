/** Text only: the policy returns the branch and actual numerical operands. */
export const amMethodMessages = {
  zh: {
    dutyElectric:
      '纯电按 2026 年配额／优惠资格成立的假设情景计算，关税暂列 0。配额、车辆年份和进口资格尚未核验，这不是保证免税。',
    dutyYoungLargePetrol:
      '按年份差为 {age} 年，命中未满 3 年档；汽油排量 {cc} cc 超过 2,800 cc，采用 {rate}% 参考税率。车价加已填运保换算取整后的计税价值 {value} AMD 乘该税率，税额四舍五入至整数 AMD。',
    dutyYoung:
      '按年份差为 {age} 年，命中未满 3 年档，采用 {rate}% 参考关税率。车价加已填运保换算取整后的计税价值 {value} AMD 乘该税率，税额四舍五入至整数 AMD。',
    dutyMiddle:
      '按年份差为 {age} 年，命中 3 年至未满 7 年档：计税价值 {value} AMD × {rate}% 得 {percentage} AMD，与 {cc} cc × {perCc} EUR/cc × {euroRate} AMD/EUR 得 {minimum} AMD 比较。取较大值 {selected} AMD，再四舍五入至整数 AMD。',
    dutyOld:
      '按年份差为 {age} 年，命中 7 年及以上档；排量 {cc} cc 对应 {perCc} EUR/cc。按 {euroRate} AMD/EUR 换算税额，再四舍五入至整数 AMD。',
    excise: '本参考模型对本类乘用车不另计消费税，因此本项为 0；关税、增值税和环保税仍各自计算。',
    vatElectric:
      '纯电按 2026 年优惠资格成立的假设情景暂列增值税 0；实际年份、配额和资格尚未核验，不能视为已获免税。',
    vat: '增值税以取整后的计税价值 {value} AMD 加已取整关税 {duty} AMD 为税基，共 {taxableBase} AMD。乘 {rate}% 后，四舍五入至整数 AMD。',
    environmentalElectric:
      '本参考模型将纯电车辆列入环保税免征类别，因此本项为 0；这与关税及增值税的配额优惠假设分别判断。',
    environmentalHybrid:
      '本参考模型将混合动力（含插混／串联增程）列入环保税免征类别，即使车龄为 {age} 年，本项仍为 0；并不因此免除关税或增值税。',
    environmentalYoung:
      '普通燃油车按年份差为 {age} 年，未超过 5 年的环保税起征界线，因此本项为 0。',
    environmental:
      '普通燃油车按年份差为 {age} 年：超过 5 至 10 年为 2%，超过 10 至 15 年为 10%，超过 15 年为 20%；本车命中 {rate}% 档。以计税价值 {value} AMD 乘该税率，再四舍五入至整数 AMD。',
  },
  en: {
    dutyElectric:
      'BEV duty is provisionally zero under the assumption that the 2026 quota and exemption conditions are met. Quota availability, vehicle year and import eligibility are unverified; this is not a guaranteed exemption.',
    dutyYoungLargePetrol:
      'Calendar-year age {age} falls below 3 years; the petrol engine is {cc} cc, above 2,800 cc, so the reference rate is {rate}%. Apply it to customs value AMD {value}, obtained by converting the price plus supplied freight and insurance and rounding to whole AMD, then round duty to whole AMD.',
    dutyYoung:
      'Calendar-year age {age} falls below 3 years, selecting a reference duty rate of {rate}%. Apply it to customs value AMD {value}, obtained by converting the price plus supplied freight and insurance and rounding to whole AMD, then round duty to whole AMD.',
    dutyMiddle:
      'Calendar-year age {age} falls from 3 to below 7 years: AMD {value} × {rate}% gives AMD {percentage}; {cc} cc × EUR {perCc}/cc × {euroRate} AMD/EUR gives AMD {minimum}. Choose the larger AMD {selected}, then round to whole AMD.',
    dutyOld:
      'Calendar-year age {age} falls in the 7-years-and-over band; {cc} cc selects EUR {perCc}/cc. Convert the duty at {euroRate} AMD/EUR, then round to whole AMD.',
    excise:
      'This reference model does not add a separate excise charge for this passenger-car category, so this line is zero; duty, VAT and environmental tax are calculated separately.',
    vatElectric:
      'BEV VAT is provisionally zero under the assumption that the 2026 exemption conditions are met. Vehicle year, quota and eligibility remain unverified; this is not confirmation of an exemption.',
    vat: 'The VAT base is rounded customs value AMD {value} plus rounded duty AMD {duty}, totaling AMD {taxableBase}. Apply {rate}% and round the result to whole AMD.',
    environmentalElectric:
      'This reference model places BEVs in the environmentally exempt category, so this line is zero; the duty and VAT quota assumptions are assessed separately.',
    environmentalHybrid:
      'This reference model exempts hybrids, including plug-in and series range extenders, from environmental tax even at age {age}. This does not grant a duty or VAT exemption.',
    environmentalYoung:
      'The conventional combustion vehicle has a calendar-year age of {age}, within the first 5 years, so environmental tax is zero.',
    environmental:
      'For conventional combustion vehicles, calendar-year ages over 5 through 10 use 2%, over 10 through 15 use 10%, and over 15 use 20%; this vehicle is {age} years old and selects {rate}%. Apply that rate to customs value AMD {value}, then round to whole AMD.',
  },
  ru: {
    dutyElectric:
      'Пошлина электромобиля предварительно равна 0 при допущении, что выполнены условия квоты и льготы 2026 года. Наличие квоты, год автомобиля и право на ввоз не проверены; освобождение не гарантируется.',
    dutyYoungLargePetrol:
      'Возраст по разнице годов {age}, категория до 3 лет; бензиновый двигатель {cc} см³ превышает 2 800 см³, поэтому справочная ставка — {rate}%. Она применяется к стоимости {value} AMD, полученной переводом цены с указанными перевозкой и страховкой и округлением до целого AMD; пошлина также округляется до целого AMD.',
    dutyYoung:
      'Возраст по разнице годов {age}, категория до 3 лет; справочная ставка — {rate}%. Она применяется к стоимости {value} AMD, полученной переводом цены с указанными перевозкой и страховкой и округлением до целого AMD; пошлина также округляется до целого AMD.',
    dutyMiddle:
      'Возраст по разнице годов {age}, категория от 3 до 7 лет: {value} AMD × {rate}% = {percentage} AMD; {cc} см³ × {perCc} EUR/см³ × {euroRate} AMD/EUR = {minimum} AMD. Выбирается большая сумма {selected} AMD, затем округляется до целого AMD.',
    dutyOld:
      'Возраст по разнице годов {age}, категория от 7 лет; для {cc} см³ применяется ставка {perCc} EUR/см³. Пошлина переводится по {euroRate} AMD/EUR и округляется до целого AMD.',
    excise:
      'В этой справочной модели для данной категории легковых автомобилей отдельный акциз не начисляется, поэтому строка равна 0; пошлина, НДС и экологический налог рассчитываются отдельно.',
    vatElectric:
      'НДС электромобиля предварительно равен 0 при допущении, что выполнены условия льготы 2026 года. Год автомобиля, квота и право на льготу ещё не проверены; освобождение не подтверждено.',
    vat: 'База НДС: округлённая таможенная стоимость {value} AMD плюс округлённая пошлина {duty} AMD, итого {taxableBase} AMD. Применяется ставка {rate}%, результат округляется до целого AMD.',
    environmentalElectric:
      'В справочной модели электромобиль относится к категории освобождения от экологического налога, поэтому строка равна 0; квотные допущения по пошлине и НДС проверяются отдельно.',
    environmentalHybrid:
      'Справочная модель освобождает гибриды, включая подключаемые и последовательные, от экологического налога даже в возрасте {age} лет. Это не освобождает от пошлины или НДС.',
    environmentalYoung:
      'Возраст обычного автомобиля с ДВС по разнице годов составляет {age}: не более 5 лет, поэтому экологический налог равен 0.',
    environmental:
      'Для обычного автомобиля с ДВС возраст старше 5 и до 10 лет включительно означает 2%, старше 10 и до 15 — 10%, старше 15 — 20%; возраст {age} соответствует ставке {rate}%. Ставка применяется к стоимости {value} AMD, результат округляется до целого AMD.',
  },
} as const;
