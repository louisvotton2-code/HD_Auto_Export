import { eaeuMethodMessages } from '../eaeu-method-messages';

export const kgMethodMessages = {
  zh: {
    ...eaeuMethodMessages.zh,
    excise:
      '本参考模型对本类乘用车不另计消费税，因此本项为 0；关税、增值税及手续费仍分别判断。',
    vatPersonal:
      '采用个人综合关税口径，增值税已在该口径处理，不在关税以外再次征计，因此本项为 0。',
    registrationEstimate:
      '个人首登暂按计税价值 {value} EUR 的 {rate}% 估算；先保留两位为 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算并保留两位。这不是官方核定金额，实际可能按市场估值计收，且未加入上方进口费用合计。',
    dutyElectric:
      "按未获配额的 8703 80 纯电驱动车计税价值 {value} EUR × {rate}%，得 {eurAmount} EUR，按 {euroRate} KGS/EUR 换算。",
    dutyCompanyYoung:
      "未满三年的普通企业进口车，计税价值 {value} EUR 按 {rate}% 计，得 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算。",
    dutyCompanyMiddle:
      "企业进口按税号比较 {value} EUR × {rate}% 与 {cc} cc × {perCc} EUR/cc，取较高的 {eurAmount} EUR，按 {euroRate} KGS/EUR 换算。",
    dutyCompanyOld:
      "超过七年的企业进口车，按 {cc} cc × {perCc} EUR/cc 计得 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算。",
    vatElectricExempt:
      "按税号 8703 80、仅电机驱动并符合五年内生产条件的进口增值税豁免测算。",
    vat:
      "车价等计税价值 {value} EUR 加关税 {duty} EUR 得 {taxableBase} EUR，按 {rate}% 计税得 {eurAmount} EUR，再按 {euroRate} KGS/EUR 换算。",
    customsFee:
      "个人办理费暂按认可价值 {value} EUR 的 {rate}% 估得 {eurAmount} EUR，并按 {euroRate} KGS/EUR 换算，以海关核定为准。",
    companyProcessing:
      "企业办理费按计税价值 {value} KGS 的 0.4% 计，最低 500 KGS、最高 250,000 KGS。",
  },
  en: {
    ...eaeuMethodMessages.en,
    excise:
      'This reference model does not add a separate excise charge for this passenger-car category, so this line is zero; duty, VAT and processing fees are assessed separately.',
    vatPersonal:
      'The personal consolidated-duty approach already handles VAT within that tariff; no additional VAT is charged on top, so this line is zero.',
    registrationEstimate:
      'Personal first registration is estimated at {rate}% of customs value EUR {value}; round to EUR {eurAmount}, convert at {euroRate} KGS/EUR, then round to two decimals again. This is not an officially assessed fee, may use a market valuation in practice, and is excluded from the import-fee total above.',
    dutyElectric:
      "For code 8703 80 without a quota, {rate}% of EUR {value} gives EUR {eurAmount}, converted at {euroRate} KGS/EUR.",
    dutyCompanyYoung:
      "For this company import under three years old, {rate}% of EUR {value} is EUR {eurAmount}, converted at {euroRate} KGS/EUR.",
    dutyCompanyMiddle:
      "For this company tariff code use the higher of {rate}% of EUR {value} and {cc} cc at EUR {perCc}/cc. Convert EUR {eurAmount} at {euroRate} KGS/EUR.",
    dutyCompanyOld:
      "For company imports over seven years old, {cc} cc at EUR {perCc}/cc gives EUR {eurAmount}, converted at {euroRate} KGS/EUR.",
    vatElectricExempt:
      "This estimate applies import VAT relief for code 8703 80, exclusively electric drive and production within five years.",
    vat:
      "Add duty of EUR {duty} to customs value of EUR {value}. The {rate}% tax on EUR {taxableBase} is EUR {eurAmount}, converted at {euroRate} KGS/EUR.",
    customsFee:
      "The estimated personal processing fee of {rate}% on EUR {value} gives EUR {eurAmount}, converted at {euroRate} KGS/EUR, subject to customs assessment.",
    companyProcessing:
      "The company processing fee is 0.4% of the customs value of {value} KGS, with a minimum of 500 KGS and a maximum of 250,000 KGS.",
  },
  ru: {
    ...eaeuMethodMessages.ru,
    excise:
      'В этой справочной модели для данной категории легковых автомобилей отдельный акциз не начисляется, поэтому строка равна 0; пошлина, НДС и сбор рассчитываются отдельно.',
    vatPersonal:
      'При ввозе физлицом НДС учитывается в рамках совокупной ставки пошлины и повторно сверх неё не начисляется, поэтому строка равна 0.',
    registrationEstimate:
      'Первая регистрация физлица ориентировочно оценивается в {rate}% от таможенной стоимости {value} EUR: округление до {eurAmount} EUR, перевод по {euroRate} KGS/EUR и повторное округление до двух знаков. Это не официально начисленная сумма: на практике может применяться рыночная оценка; расход не входит в итог импортных платежей выше.',
    dutyElectric:
      "Без квоты по коду 8703 80 от стоимости {value} EUR взимается {rate}%, т. е. {eurAmount} EUR по курсу {euroRate} KGS/EUR.",
    dutyCompanyYoung:
      "Для коммерческого ввоза до трёх лет {rate}% от {value} EUR дают {eurAmount} EUR по курсу {euroRate} KGS/EUR.",
    dutyCompanyMiddle:
      "По товарному коду сравниваются {rate}% от {value} EUR и {cc} см³ по {perCc} EUR/см³. Сумма {eurAmount} EUR пересчитывается по {euroRate} KGS/EUR.",
    dutyCompanyOld:
      "При коммерческом ввозе старше семи лет {cc} см³ по {perCc} EUR/см³ дают {eurAmount} EUR по курсу {euroRate} KGS/EUR.",
    vatElectricExempt:
      "Расчёт учитывает освобождение от ввозного НДС по коду 8703 80 при исключительно электрическом приводе и возрасте менее пяти лет.",
    vat:
      "К стоимости {value} EUR прибавляется пошлина {duty} EUR. НДС {rate}% от {taxableBase} EUR составляет {eurAmount} EUR по курсу {euroRate} KGS/EUR.",
    customsFee:
      "Ориентировочный личный сбор {rate}% от {value} EUR составляет {eurAmount} EUR по курсу {euroRate} KGS/EUR. Применимость уточняет таможня.",
    companyProcessing:
      "Сбор при коммерческом ввозе равен 0,4% от стоимости {value} KGS в пределах от 500 до 250 000 KGS.",
  },
} as const;
