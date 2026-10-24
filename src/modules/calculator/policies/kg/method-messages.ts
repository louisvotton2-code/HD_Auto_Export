/** Localized presentation only; fee selection and operands come from the policy. */
export const kgMethodMessages = {
  zh: {
    dutyElectric:
      '纯电／串联增程按未享配额优惠的标准情景，以计税价值 {value} EUR 的 {rate}% 计关税。先将欧元税额保留两位为 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算并保留两位。',
    dutyCompanyYoung:
      '企业进口按年份差为 {age} 年，命中不超过 3 年档；计税价值 {value} EUR 乘 {rate}%。先得两位欧元税额 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算并保留两位。',
    dutyPersonalYoung:
      '个人进口按年份差为 {age} 年，命中不超过 3 年档：价值 {value} EUR × {rate}% 得 {percentage} EUR，与 {cc} cc × {perCc} EUR/cc 得 {minimum} EUR 比较，取较大值 {selected} EUR。税额先保留两位为 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算并保留两位。',
    dutyPersonalMiddle:
      '个人进口按年份差为 {age} 年，命中超过 3 年且不超过 5 年档；{cc} cc 对应 {perCc} EUR/cc。先得两位欧元税额 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算并保留两位。',
    dutyPersonalOld:
      '个人进口按年份差为 {age} 年，命中超过 5 年档；{cc} cc 对应 {perCc} EUR/cc。先得两位欧元税额 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算并保留两位。',
    dutyCompanyMiddle:
      '企业进口按年份差为 {age} 年，命中超过 3 年且不超过 7 年档：价值 {value} EUR × {rate}% 得 {percentage} EUR，与 {cc} cc × {perCc} EUR/cc 得 {minimum} EUR 比较，取较大值 {selected} EUR。税额先保留两位为 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算并保留两位。',
    dutyCompanyOld:
      '企业进口按年份差为 {age} 年，命中超过 7 年档；{cc} cc 对应 {perCc} EUR/cc。先得两位欧元税额 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算并保留两位。',
    excise: '本参考模型对本类乘用车不另计消费税，因此本项为 0；关税、增值税及手续费仍分别判断。',
    vatPersonal: '采用个人综合关税口径，增值税已在该口径处理，不在关税以外再次征计，因此本项为 0。',
    vatElectricExempt:
      '企业纯电／串联增程按年份差为 {age} 年，命中不超过 5 年的参考增值税豁免情景，因此本项为 0；实际资格仍须核验。',
    vat: '企业增值税税基为计税价值 {value} EUR 加已保留两位的关税 {duty} EUR，共 {taxableBase} EUR，税率 {rate}%。税额先保留两位为 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算并保留两位。',
    customsFee:
      '按车价加已填运保换算后的计税价值 {value} EUR 计收 {rate}% 参考手续费。先得两位欧元金额 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算并保留两位；这是参考站口径，与官方个人计算器可能不同。',
    registrationEstimate:
      '个人首登暂按计税价值 {value} EUR 的 {rate}% 估算；先保留两位为 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算并保留两位。这不是官方核定金额，实际可能按市场估值计收，且未加入上方进口费用合计。',
  },
  en: {
    dutyElectric:
      'BEVs and series range extenders use the standard scenario without a quota exemption: {rate}% of the customs value of EUR {value}. Round the duty to EUR {eurAmount} first, then convert at {euroRate} KGS/EUR and round to two decimals again.',
    dutyCompanyYoung:
      'Company import, calendar-year age {age}, falls in the up-to-3-year band: {rate}% of EUR {value}. Round the duty to EUR {eurAmount} first, then convert at {euroRate} KGS/EUR and round to two decimals again.',
    dutyPersonalYoung:
      'Personal import, calendar-year age {age}, falls in the up-to-3-year band: EUR {value} × {rate}% gives EUR {percentage}; {cc} cc × EUR {perCc}/cc gives EUR {minimum}; take the larger EUR {selected}. Round to EUR {eurAmount}, convert at {euroRate} KGS/EUR, then round to two decimals again.',
    dutyPersonalMiddle:
      'Personal import, calendar-year age {age}, falls in the over-3-to-5-year band; {cc} cc selects EUR {perCc}/cc. Round the duty to EUR {eurAmount} first, then convert at {euroRate} KGS/EUR and round to two decimals again.',
    dutyPersonalOld:
      'Personal import, calendar-year age {age}, falls in the over-5-year band; {cc} cc selects EUR {perCc}/cc. Round the duty to EUR {eurAmount} first, then convert at {euroRate} KGS/EUR and round to two decimals again.',
    dutyCompanyMiddle:
      'Company import, calendar-year age {age}, falls in the over-3-to-7-year band: EUR {value} × {rate}% gives EUR {percentage}; {cc} cc × EUR {perCc}/cc gives EUR {minimum}; take the larger EUR {selected}. Round to EUR {eurAmount}, convert at {euroRate} KGS/EUR, then round to two decimals again.',
    dutyCompanyOld:
      'Company import, calendar-year age {age}, falls in the over-7-year band; {cc} cc selects EUR {perCc}/cc. Round the duty to EUR {eurAmount} first, then convert at {euroRate} KGS/EUR and round to two decimals again.',
    excise:
      'This reference model does not add a separate excise charge for this passenger-car category, so this line is zero; duty, VAT and processing fees are assessed separately.',
    vatPersonal:
      'The personal consolidated-duty approach already handles VAT within that tariff; no additional VAT is charged on top, so this line is zero.',
    vatElectricExempt:
      'The company BEV or series range extender has a calendar-year age of {age}, within the reference VAT exemption for vehicles up to 5 years old. This line is zero under that scenario; eligibility still requires verification.',
    vat: 'Company VAT uses customs value EUR {value} plus duty already rounded to EUR {duty}: a base of EUR {taxableBase}, taxed at {rate}%. Round VAT to EUR {eurAmount}, convert at {euroRate} KGS/EUR, then round to two decimals again.',
    customsFee:
      'The reference processing fee is {rate}% of customs value EUR {value}, converted from the price plus supplied freight and insurance. Round to EUR {eurAmount}, convert at {euroRate} KGS/EUR, then round to two decimals again; this reference-site treatment may differ from the official personal calculator.',
    registrationEstimate:
      'Personal first registration is estimated at {rate}% of customs value EUR {value}; round to EUR {eurAmount}, convert at {euroRate} KGS/EUR, then round to two decimals again. This is not an officially assessed fee, may use a market valuation in practice, and is excluded from the import-fee total above.',
  },
  ru: {
    dutyElectric:
      'Для электромобиля или последовательного гибрида применяется стандартный сценарий без льготной квоты: {rate}% от таможенной стоимости {value} EUR. Сначала пошлина округляется до {eurAmount} EUR, затем переводится по {euroRate} KGS/EUR и снова округляется до двух знаков.',
    dutyCompanyYoung:
      'Ввоз юрлицом: возраст по разнице годов {age}, категория до 3 лет включительно; ставка {rate}% от {value} EUR. Сначала пошлина округляется до {eurAmount} EUR, затем переводится по {euroRate} KGS/EUR и снова округляется до двух знаков.',
    dutyPersonalYoung:
      'Ввоз физлицом: возраст по разнице годов {age}, категория до 3 лет включительно; {value} EUR × {rate}% = {percentage} EUR, а {cc} см³ × {perCc} EUR/см³ = {minimum} EUR; выбирается большая сумма {selected} EUR. Она округляется до {eurAmount} EUR, переводится по {euroRate} KGS/EUR и снова округляется до двух знаков.',
    dutyPersonalMiddle:
      'Ввоз физлицом: возраст по разнице годов {age}, категория старше 3 и до 5 лет включительно; для {cc} см³ применяется {perCc} EUR/см³. Пошлина округляется до {eurAmount} EUR, переводится по {euroRate} KGS/EUR и снова округляется до двух знаков.',
    dutyPersonalOld:
      'Ввоз физлицом: возраст по разнице годов {age}, категория старше 5 лет; для {cc} см³ применяется {perCc} EUR/см³. Пошлина округляется до {eurAmount} EUR, переводится по {euroRate} KGS/EUR и снова округляется до двух знаков.',
    dutyCompanyMiddle:
      'Ввоз юрлицом: возраст по разнице годов {age}, категория старше 3 и до 7 лет включительно; {value} EUR × {rate}% = {percentage} EUR, а {cc} см³ × {perCc} EUR/см³ = {minimum} EUR; выбирается большая сумма {selected} EUR. Она округляется до {eurAmount} EUR, переводится по {euroRate} KGS/EUR и снова округляется до двух знаков.',
    dutyCompanyOld:
      'Ввоз юрлицом: возраст по разнице годов {age}, категория старше 7 лет; для {cc} см³ применяется {perCc} EUR/см³. Пошлина округляется до {eurAmount} EUR, переводится по {euroRate} KGS/EUR и снова округляется до двух знаков.',
    excise:
      'В этой справочной модели для данной категории легковых автомобилей отдельный акциз не начисляется, поэтому строка равна 0; пошлина, НДС и сбор рассчитываются отдельно.',
    vatPersonal:
      'При ввозе физлицом НДС учитывается в рамках совокупной ставки пошлины и повторно сверх неё не начисляется, поэтому строка равна 0.',
    vatElectricExempt:
      'Для электромобиля или последовательного гибрида юрлица возраст по разнице годов составляет {age}: действует справочный сценарий освобождения от НДС до 5 лет включительно. Сумма равна 0 в рамках этого допущения; право на льготу требует проверки.',
    vat: 'База НДС юрлица: таможенная стоимость {value} EUR плюс пошлина, уже округлённая до {duty} EUR, итого {taxableBase} EUR; ставка {rate}%. НДС округляется до {eurAmount} EUR, переводится по {euroRate} KGS/EUR и снова округляется до двух знаков.',
    customsFee:
      'Справочный сбор составляет {rate}% от таможенной стоимости {value} EUR, полученной из цены и указанных перевозки и страховки. Сумма округляется до {eurAmount} EUR, переводится по {euroRate} KGS/EUR и снова округляется до двух знаков; подход сайта-образца может отличаться от официального калькулятора для физлиц.',
    registrationEstimate:
      'Первая регистрация физлица ориентировочно оценивается в {rate}% от таможенной стоимости {value} EUR: округление до {eurAmount} EUR, перевод по {euroRate} KGS/EUR и повторное округление до двух знаков. Это не официально начисленная сумма: на практике может применяться рыночная оценка; расход не входит в итог импортных платежей выше.',
  },
} as const;
