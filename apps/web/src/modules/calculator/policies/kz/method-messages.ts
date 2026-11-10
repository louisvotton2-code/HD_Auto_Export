export const kzMethodMessages = {
  zh: {
    customsFee: '以当年参考月度计算指标 MCI {mci} KZT 为基数，手续费固定为 {coefficient} MCI。',
    dutyElectric:
      '纯电及串联增程使用参考电动车关税口径，本项关税按 0 计；这不同时免除增值税或其他费用。',
    dutyYoung:
      '车龄 {ageMonths} 个月，未超过 84 个月，按折合车价 {value} KZT 的 {percentage}% 计征关税，并四舍五入至整 KZT。',
    exciseElectric: '纯电没有内燃机排量，因此不计排量消费税；豪车消费税另按车价判断。',
    excise: '排量 {cc} cc 超过 3000 cc，对全部排量按每 cc {perCc} KZT 计税，不只计算超出的部分。',
    exciseZero: '排量 {cc} cc 未超过 3000 cc，未触发排量消费税，本项为 0。',
    luxuryExcise:
      '折合车价 {value} KZT 超过门槛 {threshold} KZT，按全部车价的 {percentage}% 计豪车消费税并取整。',
    luxuryExciseZero: '折合车价 {value} KZT 未超过 {threshold} KZT 门槛，因此不计豪车消费税。',
    vat: '增值税税基为车价 {value}＋未取整关税 {duty}＋排量消费税 {engineExcise}＋已取整豪车消费税 {luxuryExcise}＋手续费 {customsFee}，合计 {base} KZT。按税基的 {percentage}% 计算并四舍五入至整 KZT。',
    plates:
      '牌证费用分为车牌 {plateCoefficient} MCI 与证件 {documentCoefficient} MCI，两项相加后乘当年参考 MCI {mci} KZT 并取整。',
    recyclingElectric:
      '纯电及串联增程按参考电动车口径免计本项回收费，未将该优惠扩展到普通混动或插电混动。',
    relatedCosts:
      '固定加入参考市场服务估算 {amount} KZT，用于相关办理费用；这不是按车辆条件计算的法定税额，实际报价需另行确认。',
    dutyOld:
      '车龄 {ageMonths} 个月，已超过 84 个月；车价 {value} KZT 的 {percentage}% 为 {valueDuty} KZT。排量 {cc} cc 属于超过 {lower}、不超过 {upper} cc档，以 {perCc} EUR/cc、{euroRate} KZT/EUR 得最低额 {minimumDuty} KZT，与前者比较取较大值并取整。',
    recycling:
      '排量 {cc} cc 落入超过 {lower}、不超过 {upper} cc档，回收系数为 {coefficient}。以 {baseCoefficient} 倍当年参考 MCI（每 MCI {mci} KZT）为基数，再乘该排量系数。',
    dutyOldTop:
      '车龄 {ageMonths} 个月，已超过 84 个月；车价 {value} KZT 的 {percentage}% 为 {valueDuty} KZT。排量 {cc} cc 属于超过 {lower} cc档，以 {perCc} EUR/cc、{euroRate} KZT/EUR 得最低额 {minimumDuty} KZT，与前者比较取较大值并取整。',
    recyclingTop:
      '排量 {cc} cc 落入超过 {lower} cc档，回收系数为 {coefficient}。以 {baseCoefficient} 倍当年参考 MCI（每 MCI {mci} KZT）为基数，再乘该排量系数。',
    registrationYoung:
      '按清关年份减制造年份，年差为 {ageYears}，属于不超过 1 年档；首登按 {coefficient} × 参考 MCI {mci} KZT 计算并取整。',
    registrationStandardOld:
      '按清关年份减制造年份，年差为 {ageYears}，使用燃油／普通混动超过 2 年首登档。对应系数 {coefficient} 乘参考 MCI {mci} KZT，并四舍五入至整 KZT。',
    registrationStandardMiddle:
      '按清关年份减制造年份，年差为 {ageYears}，使用燃油／普通混动超过 1 年、不超过 2 年首登档。对应系数 {coefficient} 乘参考 MCI {mci} KZT，并四舍五入至整 KZT。',
    registrationElectricOld:
      '按清关年份减制造年份，年差为 {ageYears}，使用纯电／串联增程超过 2 年首登档。对应系数 {coefficient} 乘参考 MCI {mci} KZT，并四舍五入至整 KZT。',
    registrationElectricMiddle:
      '按清关年份减制造年份，年差为 {ageYears}，使用纯电／串联增程超过 1 年、不超过 2 年首登档。对应系数 {coefficient} 乘参考 MCI {mci} KZT，并四舍五入至整 KZT。',
  },
  en: {
    customsFee:
      'The clearance fee is a fixed {coefficient} monthly calculation indices (MCI), using the reference MCI of {mci} KZT.',
    dutyElectric:
      'BEVs and range-extended EVs follow the reference electric duty schedule, giving zero duty; VAT and other fees are calculated separately.',
    dutyYoung:
      'At {ageMonths} months, the vehicle is no older than 84 months, so duty is {percentage}% of its converted price of {value} KZT, rounded to whole KZT.',
    exciseElectric:
      'A BEV has no combustion-engine displacement, so displacement excise is zero; the price-based luxury excise is assessed separately.',
    excise:
      'At {cc} cc, displacement exceeds 3000 cc, so excise is {perCc} KZT for every cc of the entire engine, including the first 3000 cc.',
    exciseZero:
      'The {cc} cc engine does not exceed 3000 cc, so displacement excise is not triggered and this line is zero.',
    luxuryExcise:
      'The converted vehicle price of {value} KZT exceeds the {threshold} KZT threshold, so luxury excise is {percentage}% of the full price, rounded to whole KZT.',
    luxuryExciseZero:
      'The converted vehicle price of {value} KZT does not exceed the {threshold} KZT threshold, so luxury excise is zero.',
    vat: 'The VAT base is vehicle value {value} + unrounded duty {duty} + engine excise {engineExcise} + rounded luxury excise {luxuryExcise} + clearance fee {customsFee}, totalling {base} KZT. Apply {percentage}% and round to whole KZT.',
    plates:
      'Plate and document fees are {plateCoefficient} MCI and {documentCoefficient} MCI respectively; add the coefficients, multiply by the reference MCI of {mci} KZT and round.',
    recyclingElectric:
      'BEVs and range-extended EVs have zero recycling fee under the reference electric schedule; ordinary and plug-in hybrids do not use this exemption.',
    relatedCosts:
      'A fixed {amount} KZT reference market-service estimate is included for related handling services; it is not a statutory vehicle tax and needs an actual service quote.',
    dutyOld:
      'At {ageMonths} months, the vehicle exceeds 84 months: {percentage}% of {value} KZT is {valueDuty} KZT. Its {cc} cc falls above {lower} and up to {upper} cc, giving a minimum of {minimumDuty} KZT at {perCc} EUR/cc and {euroRate} KZT/EUR; take the greater of the two amounts and round.',
    recycling:
      'The {cc} cc engine falls above {lower} and up to {upper} cc, selecting recycling coefficient {coefficient}. Multiply a base of {baseCoefficient} MCI by that coefficient, with each reference MCI worth {mci} KZT.',
    dutyOldTop:
      'At {ageMonths} months, the vehicle exceeds 84 months: {percentage}% of {value} KZT is {valueDuty} KZT. Its {cc} cc falls above {lower} cc, giving a minimum of {minimumDuty} KZT at {perCc} EUR/cc and {euroRate} KZT/EUR; take the greater of the two amounts and round.',
    recyclingTop:
      'The {cc} cc engine falls above {lower} cc, selecting recycling coefficient {coefficient}. Multiply a base of {baseCoefficient} MCI by that coefficient, with each reference MCI worth {mci} KZT.',
    registrationYoung:
      'The clearance year minus manufacturing year is {ageYears}, in the up-to-1-year band; initial registration is {coefficient} times the reference MCI of {mci} KZT, rounded.',
    registrationStandardOld:
      'The clearance year minus manufacturing year is {ageYears}, selecting the combustion / ordinary hybrid registration band for over 2 years. Multiply its coefficient {coefficient} by the reference MCI of {mci} KZT and round to whole KZT.',
    registrationStandardMiddle:
      'The clearance year minus manufacturing year is {ageYears}, selecting the combustion / ordinary hybrid registration band for over 1 and up to 2 years. Multiply its coefficient {coefficient} by the reference MCI of {mci} KZT and round to whole KZT.',
    registrationElectricOld:
      'The clearance year minus manufacturing year is {ageYears}, selecting the electric / range-extended registration band for over 2 years. Multiply its coefficient {coefficient} by the reference MCI of {mci} KZT and round to whole KZT.',
    registrationElectricMiddle:
      'The clearance year minus manufacturing year is {ageYears}, selecting the electric / range-extended registration band for over 1 and up to 2 years. Multiply its coefficient {coefficient} by the reference MCI of {mci} KZT and round to whole KZT.',
  },
  ru: {
    customsFee:
      'Сбор равен {coefficient} месячным расчётным показателям (МРП); в справочном расчёте МРП составляет {mci} KZT.',
    dutyElectric:
      'Электромобили и последовательные гибриды следуют справочной электрической схеме с нулевой пошлиной; НДС и прочие платежи рассчитываются отдельно.',
    dutyYoung:
      'Возраст {ageMonths} мес. не превышает 84 месяцев: пошлина равна {percentage}% от стоимости автомобиля {value} KZT с округлением до целых KZT.',
    exciseElectric:
      'У электромобиля нет объёма ДВС, поэтому объёмный акциз равен нулю; акциз на дорогие автомобили проверяется отдельно.',
    excise:
      'Объём {cc} см³ превышает 3000 см³: ставка {perCc} KZT/см³ применяется ко всему объёму двигателя, а не только к превышению.',
    exciseZero: 'Объём {cc} см³ не превышает 3000 см³: объёмный акциз не начисляется.',
    luxuryExcise:
      'Стоимость автомобиля {value} KZT превышает порог {threshold} KZT: акциз на дорогие автомобили равен {percentage}% всей стоимости с округлением до целых KZT.',
    luxuryExciseZero:
      'Стоимость автомобиля {value} KZT не превышает порог {threshold} KZT, поэтому акциз на дорогие автомобили не начисляется.',
    vat: 'База НДС: стоимость {value} + неокруглённая пошлина {duty} + объёмный акциз {engineExcise} + округлённый акциз на дорогие авто {luxuryExcise} + сбор {customsFee}, всего {base} KZT. Применяется ставка {percentage}% с округлением до целых KZT.',
    plates:
      'Номерные знаки стоят {plateCoefficient} МРП, документы — {documentCoefficient} МРП; сумма коэффициентов умножается на справочный МРП {mci} KZT и округляется.',
    recyclingElectric:
      'Для электромобилей и последовательных гибридов утилизационный сбор по справочной электрической схеме равен нулю; обычные и подключаемые гибриды эту льготу не используют.',
    relatedCosts:
      'Добавлена фиксированная рыночная оценка сопутствующих услуг {amount} KZT; это не установленный законом налог, фактическую цену услуг нужно подтвердить.',
    dutyOld:
      'Возраст {ageMonths} мес. превышает 84: {percentage}% от {value} KZT составляют {valueDuty} KZT. Объём {cc} см³ попадает в диапазон свыше {lower} до {upper} см³ включительно; минимум по {perCc} EUR/см³ и курсу {euroRate} KZT/EUR равен {minimumDuty} KZT, выбирается большая сумма и округляется.',
    recycling:
      'Объём {cc} см³ попадает в диапазон свыше {lower} до {upper} см³ включительно: коэффициент {coefficient}. База {baseCoefficient} МРП умножается на этот коэффициент; справочный МРП равен {mci} KZT.',
    dutyOldTop:
      'Возраст {ageMonths} мес. превышает 84: {percentage}% от {value} KZT составляют {valueDuty} KZT. Объём {cc} см³ попадает в диапазон свыше {lower} см³; минимум по {perCc} EUR/см³ и курсу {euroRate} KZT/EUR равен {minimumDuty} KZT, выбирается большая сумма и округляется.',
    recyclingTop:
      'Объём {cc} см³ попадает в диапазон свыше {lower} см³: коэффициент {coefficient}. База {baseCoefficient} МРП умножается на этот коэффициент; справочный МРП равен {mci} KZT.',
    registrationYoung:
      'Разница года оформления и выпуска — {ageYears}, применяется диапазон до 1 года включительно: первичная регистрация равна {coefficient} × справочный МРП {mci} KZT с округлением.',
    registrationStandardOld:
      'Разница года оформления и выпуска — {ageYears}: применяется диапазон свыше 2 лет для ДВС / обычных гибридов. Коэффициент {coefficient} умножается на справочный МРП {mci} KZT с округлением до целых KZT.',
    registrationStandardMiddle:
      'Разница года оформления и выпуска — {ageYears}: применяется диапазон свыше 1 до 2 лет включительно для ДВС / обычных гибридов. Коэффициент {coefficient} умножается на справочный МРП {mci} KZT с округлением до целых KZT.',
    registrationElectricOld:
      'Разница года оформления и выпуска — {ageYears}: применяется диапазон свыше 2 лет для электромобилей / последовательных гибридов. Коэффициент {coefficient} умножается на справочный МРП {mci} KZT с округлением до целых KZT.',
    registrationElectricMiddle:
      'Разница года оформления и выпуска — {ageYears}: применяется диапазон свыше 1 до 2 лет включительно для электромобилей / последовательных гибридов. Коэффициент {coefficient} умножается на справочный МРП {mci} KZT с округлением до целых KZT.',
  },
} as const;
