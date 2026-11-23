import { eaeuMethodMessages } from '../eaeu-method-messages';

export const kzMethodMessages = {
  zh: {
    ...eaeuMethodMessages.zh,
    goodsEngineExcise: '普通乘用车排量为 {cc} cc。一般商品申报时，超过 3,000 cc 按全部排量每 cc 100 KZT 计消费税，其余为零。',
    goodsBevDuty: '一般商品申报的普通纯电乘用车按完税价格 {value} KZT 的 {percentage}% 计征关税。',
    customsFee: '以当年参考月度计算指标 MCI {mci} KZT 为基数，手续费固定为 {coefficient} MCI。',
    luxuryExcise:
      '海关核定购入价值 {value} KZT 达到或超过门槛 {threshold} KZT，按全部车价的 {percentage}% 计豪车消费税并取整。',
    luxuryExciseZero: '海关核定购入价值 {value} KZT 低于 {threshold} KZT 门槛，因此不计豪车消费税。',
    vat: '增值税税基为完税价格 {value}＋未取整关税 {duty}＋排量消费税 {engineExcise}＋已取整豪车消费税 {luxuryExcise}＋手续费 {customsFee}，合计 {base} KZT。按税基的 {percentage}% 计算并四舍五入至整 KZT。',
    plates:
      '牌证费用分为车牌 {plateCoefficient} MCI 与证件 {documentCoefficient} MCI，两项相加后乘当年参考 MCI {mci} KZT 并取整。',
    recyclingElectric:
      '纯电按电动车口径免计本项回收费，未将该优惠扩展到普通混动或插电混动。',
    relatedCosts:
      '另列市场服务估算 {amount} KZT，用于相关办理费用；这不是按车辆条件计算的法定税额，实际报价需另行确认。',
    recycling:
      '排量 {cc} cc 落入超过 {lower}、不超过 {upper} cc档，回收系数为 {coefficient}。以 {baseCoefficient} 倍当年参考 MCI（每 MCI {mci} KZT）为基数，再乘该排量系数。',
    recyclingTop:
      '排量 {cc} cc 落入超过 {lower} cc档，回收系数为 {coefficient}。以 {baseCoefficient} 倍当年参考 MCI（每 MCI {mci} KZT）为基数，再乘该排量系数。',
    registrationYoung:
      '按清关年份减制造年份，年差为 {ageYears}，属于不超过 1 年档；首登按 {coefficient} × 参考 MCI {mci} KZT 计算并取整。',
    registrationStandardOld:
      '按清关年份减制造年份，年差为 {ageYears}，使用燃油／普通混动超过 2 年首登档。对应系数 {coefficient} 乘参考 MCI {mci} KZT，并四舍五入至整 KZT。',
    registrationStandardMiddle:
      '按清关年份减制造年份，年差为 {ageYears}，使用燃油／普通混动超过 1 年、不超过 2 年首登档。对应系数 {coefficient} 乘参考 MCI {mci} KZT，并四舍五入至整 KZT。',
    registrationElectricOld:
      '按清关年份减制造年份，年差为 {ageYears}，使用纯电超过 2 年首登档。对应系数 {coefficient} 乘参考 MCI {mci} KZT，并四舍五入至整 KZT。',
    registrationElectricMiddle:
      '按清关年份减制造年份，年差为 {ageYears}，使用纯电超过 1 年、不超过 2 年首登档。对应系数 {coefficient} 乘参考 MCI {mci} KZT，并四舍五入至整 KZT。',
  },
  en: {
    ...eaeuMethodMessages.en,
    goodsEngineExcise: 'The engine displaces {cc} cc. For standard goods, a passenger car above 3,000 cc incurs KZT 100 on every cc. At or below that threshold the charge is zero.',
    goodsBevDuty: 'For a standard battery-electric passenger car declared as goods, apply {percentage}% to the customs value of {value} KZT.',
    customsFee:
      'The clearance fee is a fixed {coefficient} monthly calculation indices (MCI), using the reference MCI of {mci} KZT.',
    luxuryExcise:
      'The customs acquisition value of {value} KZT reaches or exceeds the {threshold} KZT threshold, so luxury excise is {percentage}% of the full price, rounded to whole KZT.',
    luxuryExciseZero:
      'The customs acquisition value of {value} KZT falls below the {threshold} KZT threshold, so luxury excise is zero.',
    vat: 'The VAT base is customs value {value} + unrounded duty {duty} + engine excise {engineExcise} + rounded luxury excise {luxuryExcise} + clearance fee {customsFee}, totalling {base} KZT. Apply {percentage}% and round to whole KZT.',
    plates:
      'Plate and document fees are {plateCoefficient} MCI and {documentCoefficient} MCI respectively; add the coefficients, multiply by the reference MCI of {mci} KZT and round.',
    recyclingElectric:
      'BEVs have zero recycling fee under the reference electric schedule; ordinary and plug-in hybrids do not use this exemption.',
    relatedCosts:
      'A fixed {amount} KZT reference market-service estimate is listed separately for related handling services; it is not a statutory vehicle tax and needs an actual service quote.',
    recycling:
      'The {cc} cc engine falls above {lower} and up to {upper} cc, selecting recycling coefficient {coefficient}. Multiply a base of {baseCoefficient} MCI by that coefficient, with each reference MCI worth {mci} KZT.',
    recyclingTop:
      'The {cc} cc engine falls above {lower} cc, selecting recycling coefficient {coefficient}. Multiply a base of {baseCoefficient} MCI by that coefficient, with each reference MCI worth {mci} KZT.',
    registrationYoung:
      'The clearance year minus manufacturing year is {ageYears}, in the up-to-1-year band; initial registration is {coefficient} times the reference MCI of {mci} KZT, rounded.',
    registrationStandardOld:
      'The clearance year minus manufacturing year is {ageYears}, selecting the combustion / ordinary hybrid registration band for over 2 years. Multiply its coefficient {coefficient} by the reference MCI of {mci} KZT and round to whole KZT.',
    registrationStandardMiddle:
      'The clearance year minus manufacturing year is {ageYears}, selecting the combustion / ordinary hybrid registration band for over 1 and up to 2 years. Multiply its coefficient {coefficient} by the reference MCI of {mci} KZT and round to whole KZT.',
    registrationElectricOld:
      'The clearance year minus manufacturing year is {ageYears}, selecting the battery-electric registration band for over 2 years. Multiply its coefficient {coefficient} by the reference MCI of {mci} KZT and round to whole KZT.',
    registrationElectricMiddle:
      'The clearance year minus manufacturing year is {ageYears}, selecting the battery-electric registration band for over 1 and up to 2 years. Multiply its coefficient {coefficient} by the reference MCI of {mci} KZT and round to whole KZT.',
  },
  ru: {
    ...eaeuMethodMessages.ru,
    goodsEngineExcise: 'Объём двигателя — {cc} см³. По декларации на товары при объёме свыше 3 000 см³ начисляется 100 KZT за каждый см³, иначе акциз равен нулю.',
    goodsBevDuty: 'Для обычного легкового электромобиля по декларации на товары пошлина составляет {percentage}% от таможенной стоимости {value} KZT.',
    customsFee:
      'Сбор равен {coefficient} месячным расчётным показателям (МРП); в справочном расчёте МРП составляет {mci} KZT.',
    luxuryExcise:
      'Стоимость приобретения по таможенной оценке {value} KZT достигает или превышает порог {threshold} KZT: акциз на дорогие автомобили равен {percentage}% всей стоимости с округлением до целых KZT.',
    luxuryExciseZero:
      'Стоимость приобретения по таможенной оценке {value} KZT ниже порог {threshold} KZT, поэтому акциз на дорогие автомобили не начисляется.',
    vat: 'База НДС: таможенная стоимость {value} + неокруглённая пошлина {duty} + объёмный акциз {engineExcise} + округлённый акциз на дорогие авто {luxuryExcise} + сбор {customsFee}, всего {base} KZT. Применяется ставка {percentage}% с округлением до целых KZT.',
    plates:
      'Номерные знаки стоят {plateCoefficient} МРП, документы — {documentCoefficient} МРП; сумма коэффициентов умножается на справочный МРП {mci} KZT и округляется.',
    recyclingElectric:
      'Для электромобилей утилизационный сбор по справочной электрической схеме равен нулю; обычные и подключаемые гибриды эту льготу не используют.',
    relatedCosts:
      'Отдельно указана фиксированная рыночная оценка сопутствующих услуг {amount} KZT; это не установленный законом налог, фактическую цену услуг нужно подтвердить.',
    recycling:
      'Объём {cc} см³ попадает в диапазон свыше {lower} до {upper} см³ включительно: коэффициент {coefficient}. База {baseCoefficient} МРП умножается на этот коэффициент; справочный МРП равен {mci} KZT.',
    recyclingTop:
      'Объём {cc} см³ попадает в диапазон свыше {lower} см³: коэффициент {coefficient}. База {baseCoefficient} МРП умножается на этот коэффициент; справочный МРП равен {mci} KZT.',
    registrationYoung:
      'Разница года оформления и выпуска — {ageYears}, применяется диапазон до 1 года включительно: первичная регистрация равна {coefficient} × справочный МРП {mci} KZT с округлением.',
    registrationStandardOld:
      'Разница года оформления и выпуска — {ageYears}: применяется диапазон свыше 2 лет для ДВС / обычных гибридов. Коэффициент {coefficient} умножается на справочный МРП {mci} KZT с округлением до целых KZT.',
    registrationStandardMiddle:
      'Разница года оформления и выпуска — {ageYears}: применяется диапазон свыше 1 до 2 лет включительно для ДВС / обычных гибридов. Коэффициент {coefficient} умножается на справочный МРП {mci} KZT с округлением до целых KZT.',
    registrationElectricOld:
      'Разница года оформления и выпуска — {ageYears}: применяется диапазон свыше 2 лет для электромобилей. Коэффициент {coefficient} умножается на справочный МРП {mci} KZT с округлением до целых KZT.',
    registrationElectricMiddle:
      'Разница года оформления и выпуска — {ageYears}: применяется диапазон свыше 1 до 2 лет включительно для электромобилей. Коэффициент {coefficient} умножается на справочный МРП {mci} KZT с округлением до целых KZT.',
  },
} as const;
