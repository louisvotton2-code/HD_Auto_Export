import { eaeuMethodMessages } from '../eaeu-method-messages';

export const amMethodMessages = {
  zh: {
    ...eaeuMethodMessages.zh,
    excise:
      '本参考模型对本类乘用车不另计消费税，因此本项为 0；关税、增值税和环保税仍各自计算。',
    vat:
      '增值税以取整后的计税价值 {value} AMD 加已取整关税 {duty} AMD 为税基，共 {taxableBase} AMD。乘 {rate}% 后，四舍五入至整数 AMD。',
    electricStandardDuty:
      "未使用个车配额时，按认可车价 {value} AMD 的 15% 计关税。",
    electricVatRelief:
      "这组清关日期与生产年份满足纯电进口增值税的日期条件，按免税测算。",
    unifiedVat:
      "个人自用统一税额已含应计税款，不再另加进口增值税。",
    importEnvironment:
      "按生产年计算车龄为 {age} 年，对假定核定价值 {value} AMD 按所属档 {rate}% 计环境税。",
  },
  en: {
    ...eaeuMethodMessages.en,
    excise:
      'This reference model does not add a separate excise charge for this passenger-car category, so this line is zero; duty, VAT and environmental tax are calculated separately.',
    vat:
      'The VAT base is rounded customs value AMD {value} plus rounded duty AMD {duty}, totaling AMD {taxableBase}. Apply {rate}% and round the result to whole AMD.',
    electricStandardDuty:
      "Without an allocated quota, standard duty is 15% of the accepted value of {value} AMD.",
    electricVatRelief:
      "The clearance date and production year meet the date conditions for electric import VAT relief.",
    unifiedVat:
      "The personal-use unified charge includes the applicable import taxes. Additional VAT is zero.",
    importEnvironment:
      "An age of {age} by production year sets the environmental band at {rate}% of the estimated assessment of {value} AMD.",
  },
  ru: {
    ...eaeuMethodMessages.ru,
    excise:
      'В этой справочной модели для данной категории легковых автомобилей отдельный акциз не начисляется, поэтому строка равна 0; пошлина, НДС и экологический налог рассчитываются отдельно.',
    vat:
      'База НДС: округлённая таможенная стоимость {value} AMD плюс округлённая пошлина {duty} AMD, итого {taxableBase} AMD. Применяется ставка {rate}%, результат округляется до целого AMD.',
    electricStandardDuty:
      "Без выделенной квоты пошлина составляет 15% от принятой стоимости {value} AMD.",
    electricVatRelief:
      "Дата оформления и год выпуска отвечают условиям освобождения электромобиля от ввозного НДС.",
    unifiedVat:
      "Единый личный платёж включает причитающиеся налоги. Дополнительный НДС равен нулю.",
    importEnvironment:
      "Возраст по году выпуска — {age} лет. Ставка экологического налога {rate}% применяется к оценочной стоимости {value} AMD.",
  },
} as const;
