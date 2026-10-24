export const ruMethodMessages = {
  zh: {
    dutyElectric:
      '纯电车型按折合车价 {value} RUB 的 {percentage}% 计征关税，结果四舍五入至整 RUB。',
    dutyYoung:
      '车龄 {ageMonths} 个月，小于 36 个月；车价 {value} RUB 按 {euroRate} RUB/EUR 换算为 {euroValue} EUR，落入超过 {lower}、不超过 {upper} EUR 档。比较车价 × {percentage}% 得到的 {percentageDuty} EUR 与排量 {cc} cc × {perCc} EUR/cc 得到的 {minimumDuty} EUR，取较大者再换回 RUB 并取整。',
    dutyYoungTop:
      '车龄 {ageMonths} 个月，小于 36 个月；车价 {value} RUB 按 {euroRate} RUB/EUR 换算为 {euroValue} EUR，超过 {lower} EUR，使用最高价格档。比较车价 × {percentage}% 得到的 {percentageDuty} EUR 与排量 {cc} cc × {perCc} EUR/cc 得到的 {minimumDuty} EUR，取较大者再换回 RUB 并取整。',
    customsFee:
      '折合车价 {value} RUB 落入超过 {lower}、不超过 {upper} RUB 的手续费档，收取固定 {fee} RUB，而非按比例计算。',
    customsFeeTop: '折合车价 {value} RUB 超过最高分档门槛 {lower} RUB，收取固定手续费 {fee} RUB。',
    dutyMiddle:
      '车龄 {ageMonths} 个月，使用36 至不足 60 个月档；排量 {cc} cc 属于超过 {lower}、不超过 {upper} cc档，单价为 {perCc} EUR/cc。排量乘该单价，再按 {euroRate} RUB/EUR 换算并四舍五入至整 RUB。',
    dutyMiddleTop:
      '车龄 {ageMonths} 个月，使用36 至不足 60 个月档；排量 {cc} cc 属于超过 {lower} cc档，单价为 {perCc} EUR/cc。排量乘该单价，再按 {euroRate} RUB/EUR 换算并四舍五入至整 RUB。',
    dutyOld:
      '车龄 {ageMonths} 个月，使用60 个月及以上档；排量 {cc} cc 属于超过 {lower}、不超过 {upper} cc档，单价为 {perCc} EUR/cc。排量乘该单价，再按 {euroRate} RUB/EUR 换算并四舍五入至整 RUB。',
    dutyOldTop:
      '车龄 {ageMonths} 个月，使用60 个月及以上档；排量 {cc} cc 属于超过 {lower} cc档，单价为 {perCc} EUR/cc。排量乘该单价，再按 {euroRate} RUB/EUR 换算并四舍五入至整 RUB。',
    recyclingPersonalYoung:
      '排量 {cc} cc、功率 {hp} hp 均未超过 3000 cc／160 hp，按个人自用低系数参考假设计费。车龄 {ageMonths} 个月，使用不足 36 个月列系数 {coefficient}，乘固定基数 {base} RUB。',
    recyclingPersonalAged:
      '排量 {cc} cc、功率 {hp} hp 均未超过 3000 cc／160 hp，按个人自用低系数参考假设计费。车龄 {ageMonths} 个月，使用36 个月及以上列系数 {coefficient}，乘固定基数 {base} RUB。',
    recyclingElectricYoung:
      '纯电按功率 {hp} hp 查询电动车回收系数表，不套用燃油车个人低系数。车龄 {ageMonths} 个月，使用不足 36 个月列系数 {coefficient}，乘固定基数 {base} RUB。',
    recyclingElectricAged:
      '纯电按功率 {hp} hp 查询电动车回收系数表，不套用燃油车个人低系数。车龄 {ageMonths} 个月，使用36 个月及以上列系数 {coefficient}，乘固定基数 {base} RUB。',
    recyclingStandardYoung:
      '按排量 {cc} cc 选择回收系数表，再按功率 {hp} hp 选择行，本组不使用个人低系数。车龄 {ageMonths} 个月，使用不足 36 个月列系数 {coefficient}，乘固定基数 {base} RUB。',
    recyclingStandardAged:
      '按排量 {cc} cc 选择回收系数表，再按功率 {hp} hp 选择行，本组不使用个人低系数。车龄 {ageMonths} 个月，使用36 个月及以上列系数 {coefficient}，乘固定基数 {base} RUB。',
  },
  en: {
    dutyElectric:
      'For a battery electric vehicle, duty is {percentage}% of the converted vehicle price of {value} RUB, rounded to whole RUB.',
    dutyYoung:
      'At {ageMonths} months, the vehicle is under 36 months old: {value} RUB at {euroRate} RUB/EUR equals {euroValue} EUR, in the band above {lower} and up to {upper} EUR. Compare {percentage}% of that value ({percentageDuty} EUR) with {cc} cc at {perCc} EUR/cc ({minimumDuty} EUR), take the greater amount, convert back to RUB and round.',
    dutyYoungTop:
      'At {ageMonths} months, the vehicle is under 36 months old: {value} RUB at {euroRate} RUB/EUR equals {euroValue} EUR, above the top threshold of {lower} EUR. Compare {percentage}% of that value ({percentageDuty} EUR) with {cc} cc at {perCc} EUR/cc ({minimumDuty} EUR), take the greater amount, convert back to RUB and round.',
    customsFee:
      'The converted vehicle price of {value} RUB falls above {lower} and up to {upper} RUB, so the fixed clearance fee is {fee} RUB rather than a percentage.',
    customsFeeTop:
      'The converted vehicle price of {value} RUB exceeds the highest threshold of {lower} RUB, so the fixed clearance fee is {fee} RUB.',
    dutyMiddle:
      'At {ageMonths} months, use the 36 to under 60 months schedule: {cc} cc falls above {lower} and up to {upper} cc, at {perCc} EUR/cc. Multiply displacement by that rate, convert at {euroRate} RUB/EUR and round to whole RUB.',
    dutyMiddleTop:
      'At {ageMonths} months, use the 36 to under 60 months schedule: {cc} cc falls above {lower} cc, at {perCc} EUR/cc. Multiply displacement by that rate, convert at {euroRate} RUB/EUR and round to whole RUB.',
    dutyOld:
      'At {ageMonths} months, use the 60 months or more schedule: {cc} cc falls above {lower} and up to {upper} cc, at {perCc} EUR/cc. Multiply displacement by that rate, convert at {euroRate} RUB/EUR and round to whole RUB.',
    dutyOldTop:
      'At {ageMonths} months, use the 60 months or more schedule: {cc} cc falls above {lower} cc, at {perCc} EUR/cc. Multiply displacement by that rate, convert at {euroRate} RUB/EUR and round to whole RUB.',
    recyclingPersonalYoung:
      'At {cc} cc and {hp} hp, the 3000 cc / 160 hp limits are not exceeded, so this reference assumes the personal-use low coefficient. For {ageMonths} months, take coefficient {coefficient} from the under-36-month column and multiply by the fixed base of {base} RUB.',
    recyclingPersonalAged:
      'At {cc} cc and {hp} hp, the 3000 cc / 160 hp limits are not exceeded, so this reference assumes the personal-use low coefficient. For {ageMonths} months, take coefficient {coefficient} from the 36-month-and-over column and multiply by the fixed base of {base} RUB.',
    recyclingElectricYoung:
      'For a BEV, use {hp} hp to select the electric recycling table; the combustion personal-use low coefficient is not applied. At {ageMonths} months, use coefficient {coefficient} from the under-36-month column, multiplied by the fixed base of {base} RUB.',
    recyclingElectricAged:
      'For a BEV, use {hp} hp to select the electric recycling table; the combustion personal-use low coefficient is not applied. At {ageMonths} months, use coefficient {coefficient} from the 36-month-and-over column, multiplied by the fixed base of {base} RUB.',
    recyclingStandardYoung:
      'Select the recycling table for {cc} cc and its row for {hp} hp; the personal-use low coefficient is not used for this combination. At {ageMonths} months, use coefficient {coefficient} from the under-36-month column, multiplied by the fixed base of {base} RUB.',
    recyclingStandardAged:
      'Select the recycling table for {cc} cc and its row for {hp} hp; the personal-use low coefficient is not used for this combination. At {ageMonths} months, use coefficient {coefficient} from the 36-month-and-over column, multiplied by the fixed base of {base} RUB.',
  },
  ru: {
    dutyElectric:
      'Для электромобиля пошлина составляет {percentage}% от стоимости автомобиля {value} RUB с округлением до целых RUB.',
    dutyYoung:
      'Возраст {ageMonths} мес., то есть менее 36: стоимость {value} RUB по курсу {euroRate} RUB/EUR равна {euroValue} EUR и попадает в диапазон свыше {lower} до {upper} EUR включительно. Из {percentage}% стоимости ({percentageDuty} EUR) и {cc} см³ × {perCc} EUR/см³ ({minimumDuty} EUR) выбирается большая сумма, затем переводится в RUB и округляется.',
    dutyYoungTop:
      'Возраст {ageMonths} мес., то есть менее 36: стоимость {value} RUB по курсу {euroRate} RUB/EUR равна {euroValue} EUR и превышает верхний порог {lower} EUR. Из {percentage}% стоимости ({percentageDuty} EUR) и {cc} см³ × {perCc} EUR/см³ ({minimumDuty} EUR) выбирается большая сумма, затем переводится в RUB и округляется.',
    customsFee:
      'Стоимость автомобиля {value} RUB попадает в диапазон свыше {lower} до {upper} RUB включительно: фиксированный сбор составляет {fee} RUB, а не процент от стоимости.',
    customsFeeTop:
      'Стоимость автомобиля {value} RUB превышает верхний порог {lower} RUB: применяется фиксированный сбор {fee} RUB.',
    dutyMiddle:
      'При возрасте {ageMonths} мес. применяется таблица для от 36 до менее 60 месяцев; объём {cc} см³ попадает в диапазон свыше {lower} до {upper} см³ включительно со ставкой {perCc} EUR/см³. Объём умножается на ставку, сумма переводится по курсу {euroRate} RUB/EUR и округляется до целых RUB.',
    dutyMiddleTop:
      'При возрасте {ageMonths} мес. применяется таблица для от 36 до менее 60 месяцев; объём {cc} см³ попадает в диапазон свыше {lower} см³ со ставкой {perCc} EUR/см³. Объём умножается на ставку, сумма переводится по курсу {euroRate} RUB/EUR и округляется до целых RUB.',
    dutyOld:
      'При возрасте {ageMonths} мес. применяется таблица для 60 месяцев и более; объём {cc} см³ попадает в диапазон свыше {lower} до {upper} см³ включительно со ставкой {perCc} EUR/см³. Объём умножается на ставку, сумма переводится по курсу {euroRate} RUB/EUR и округляется до целых RUB.',
    dutyOldTop:
      'При возрасте {ageMonths} мес. применяется таблица для 60 месяцев и более; объём {cc} см³ попадает в диапазон свыше {lower} см³ со ставкой {perCc} EUR/см³. Объём умножается на ставку, сумма переводится по курсу {euroRate} RUB/EUR и округляется до целых RUB.',
    recyclingPersonalYoung:
      'Объём {cc} см³ и мощность {hp} л. с. не превышают 3000 см³ / 160 л. с.; расчёт условно применяет льготный коэффициент личного ввоза. Возраст {ageMonths} мес.: колонка до 36 месяцев, коэффициент {coefficient} умножается на базу {base} RUB.',
    recyclingPersonalAged:
      'Объём {cc} см³ и мощность {hp} л. с. не превышают 3000 см³ / 160 л. с.; расчёт условно применяет льготный коэффициент личного ввоза. Возраст {ageMonths} мес.: колонка от 36 месяцев, коэффициент {coefficient} умножается на базу {base} RUB.',
    recyclingElectricYoung:
      'Для электромобиля мощность {hp} л. с. определяет строку электрической таблицы; льготный коэффициент для ДВС не применяется. Возраст {ageMonths} мес.: колонка до 36 месяцев, коэффициент {coefficient} умножается на базу {base} RUB.',
    recyclingElectricAged:
      'Для электромобиля мощность {hp} л. с. определяет строку электрической таблицы; льготный коэффициент для ДВС не применяется. Возраст {ageMonths} мес.: колонка от 36 месяцев, коэффициент {coefficient} умножается на базу {base} RUB.',
    recyclingStandardYoung:
      'Объём {cc} см³ определяет таблицу, мощность {hp} л. с. — строку; льготный коэффициент личного ввоза для этой комбинации не применяется. Возраст {ageMonths} мес.: колонка до 36 месяцев, коэффициент {coefficient} умножается на базу {base} RUB.',
    recyclingStandardAged:
      'Объём {cc} см³ определяет таблицу, мощность {hp} л. с. — строку; льготный коэффициент личного ввоза для этой комбинации не применяется. Возраст {ageMonths} мес.: колонка от 36 месяцев, коэффициент {coefficient} умножается на базу {base} RUB.',
  },
} as const;
