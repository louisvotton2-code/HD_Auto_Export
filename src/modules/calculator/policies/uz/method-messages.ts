export const uzMethodMessages = {
  zh: {
    dutyElectric: '纯电车型在当前参考口径下关税为 0，但增值税、回收费和注册费仍分别计算。',
    vat: '将车价和已填运保折合的 {value} UZS 加上未取整关税 {duty} UZS，得到增值税税基 {base} UZS；不把手续费、回收费及注册费加入该税基。按税基的 {percentage}% 计算并四舍五入至整 UZS。',
    registrationElectric:
      '纯电使用参考电动注册系数 {coefficient}，乘当年基本计算值 BRV {brv} UZS。',
    registrationStandard:
      '燃油及混动车型使用参考注册系数 {coefficient}，乘当年基本计算值 BRV {brv} UZS。',
    customsFee:
      '车价及已填运保的计税价值折合 {customsUsd} USD，落入超过 {lower}、不超过 {upper} USD档，对应系数 {coefficient}。以当年基本计算值 BRV {brv} UZS 乘该系数。',
    customsFeeTop:
      '车价及已填运保的计税价值折合 {customsUsd} USD，落入超过 {lower} USD档，对应系数 {coefficient}。以当年基本计算值 BRV {brv} UZS 乘该系数。',
    dutyHybridNewYoung:
      '从未登记混动车龄 {ageMonths} 个月，未超过 12 个月，按新混动低税率档，不加每 cc 附加额。 计税价值 {customsUsd} USD × {percentage}%，再按 {usdRate} UZS/USD 换算并取整。',
    dutyHybridNewOld:
      '从未登记混动车龄 {ageMonths} 个月，超过 12 个月，使用较高新混动税率档，不加每 cc 附加额。 计税价值 {customsUsd} USD × {percentage}%，再按 {usdRate} UZS/USD 换算并取整。',
    dutyHybridUsedYoung:
      '二手混动车龄 {ageMonths} 个月，未超过 36 个月，使用较低二手混动比例税率及按排量分档的附加额。 计税价值 {customsUsd} USD × {percentage}%，再加排量 {cc} cc × {perCc} USD/cc，合计按 {usdRate} UZS/USD 换算并取整。',
    dutyHybridUsedOld:
      '二手混动车龄 {ageMonths} 个月，超过 36 个月，使用较高二手混动比例税率及每 cc 附加额。 计税价值 {customsUsd} USD × {percentage}%，再加排量 {cc} cc × {perCc} USD/cc，合计按 {usdRate} UZS/USD 换算并取整。',
    dutyUsed:
      '已登记的二手燃油车按二手车口径计税；车龄 {ageMonths} 个月，即使很新也不套用从未登记新车税率。 计税价值 {customsUsd} USD × {percentage}%，再加排量 {cc} cc × {perCc} USD/cc，合计按 {usdRate} UZS/USD 换算并取整。',
    dutyNewYoung:
      '从未登记燃油车龄 {ageMonths} 个月，未超过 12 个月，按新车较低比例税率和汽油／柴油对应排量档计税。 计税价值 {customsUsd} USD × {percentage}%，再加排量 {cc} cc × {perCc} USD/cc，合计按 {usdRate} UZS/USD 换算并取整。',
    dutyNewOld:
      '从未登记燃油车龄 {ageMonths} 个月，超过 12 个月，按新车较高比例税率和汽油／柴油对应排量档计税。 计税价值 {customsUsd} USD × {percentage}%，再加排量 {cc} cc × {perCc} USD/cc，合计按 {usdRate} UZS/USD 换算并取整。',
    recyclingStandardYoung:
      '排量 {cc} cc 决定回收表排量档；车龄 {ageMonths} 个月，使用不超过 36 个月档，对应系数 {coefficient}。以当年基本计算值 BRV {brv} UZS 乘该系数。',
    recyclingStandardOld:
      '排量 {cc} cc 决定回收表排量档；车龄 {ageMonths} 个月，使用超过 36 个月档，对应系数 {coefficient}。以当年基本计算值 BRV {brv} UZS 乘该系数。',
    recyclingElectricYoung:
      '纯电车龄 {ageMonths} 个月，使用电动车不超过 36 个月档，对应回收系数 {coefficient}。以当年基本计算值 BRV {brv} UZS 乘该系数。',
    recyclingElectricOld:
      '纯电车龄 {ageMonths} 个月，使用电动车超过 36 个月档，对应回收系数 {coefficient}。以当年基本计算值 BRV {brv} UZS 乘该系数。',
  },
  en: {
    dutyElectric:
      'For a BEV, duty is zero under this reference schedule; VAT, recycling and registration fees are still calculated separately.',
    vat: 'The VAT base is vehicle price plus supplied freight and insurance, converted to {value} UZS, plus unrounded duty of {duty} UZS, totalling {base} UZS; clearance, recycling and registration fees are excluded from this base. Apply {percentage}% and round to whole UZS.',
    registrationElectric:
      'BEV registration uses the electric coefficient {coefficient}, multiplied by the reference basic calculation value (BRV) of {brv} UZS.',
    registrationStandard:
      'Combustion and hybrid registration uses coefficient {coefficient}, multiplied by the reference basic calculation value (BRV) of {brv} UZS.',
    customsFee:
      'The customs value of the vehicle plus supplied freight and insurance is {customsUsd} USD, falling above {lower} and up to {upper} USD and selecting coefficient {coefficient}. Multiply it by the reference basic calculation value (BRV) of {brv} UZS.',
    customsFeeTop:
      'The customs value of the vehicle plus supplied freight and insurance is {customsUsd} USD, falling above {lower} USD and selecting coefficient {coefficient}. Multiply it by the reference basic calculation value (BRV) of {brv} UZS.',
    dutyHybridNewYoung:
      'The never-registered hybrid is {ageMonths} months old, no older than 12 months, so it uses the lower new-hybrid rate without a per-cc addition. Apply {percentage}% to customs value {customsUsd} USD, convert at {usdRate} UZS/USD and round.',
    dutyHybridNewOld:
      'The never-registered hybrid is {ageMonths} months old, over 12 months, so it uses the higher new-hybrid rate without a per-cc addition. Apply {percentage}% to customs value {customsUsd} USD, convert at {usdRate} UZS/USD and round.',
    dutyHybridUsedYoung:
      'The used hybrid is {ageMonths} months old, no older than 36 months, so it uses the lower used-hybrid percentage and a displacement-band addition. Apply {percentage}% to customs value {customsUsd} USD, add {cc} cc at {perCc} USD/cc, then convert the sum at {usdRate} UZS/USD and round.',
    dutyHybridUsedOld:
      'The used hybrid is {ageMonths} months old, over 36 months, so it uses the higher used-hybrid percentage and per-cc addition. Apply {percentage}% to customs value {customsUsd} USD, add {cc} cc at {perCc} USD/cc, then convert the sum at {usdRate} UZS/USD and round.',
    dutyUsed:
      'This registered combustion vehicle uses the used-car tariff; at {ageMonths} months, it does not qualify for the never-registered new-car schedule even if recently manufactured. Apply {percentage}% to customs value {customsUsd} USD, add {cc} cc at {perCc} USD/cc, then convert the sum at {usdRate} UZS/USD and round.',
    dutyNewYoung:
      'The never-registered combustion vehicle is {ageMonths} months old, no older than 12 months, so it uses the lower new-car percentage and the applicable petrol/diesel displacement band. Apply {percentage}% to customs value {customsUsd} USD, add {cc} cc at {perCc} USD/cc, then convert the sum at {usdRate} UZS/USD and round.',
    dutyNewOld:
      'The never-registered combustion vehicle is {ageMonths} months old, over 12 months, so it uses the higher new-car percentage and the applicable petrol/diesel displacement band. Apply {percentage}% to customs value {customsUsd} USD, add {cc} cc at {perCc} USD/cc, then convert the sum at {usdRate} UZS/USD and round.',
    recyclingStandardYoung:
      'The {cc} cc engine determines the displacement band; at {ageMonths} months, the up-to-36-month band selects recycling coefficient {coefficient}. Multiply by the reference basic calculation value (BRV) of {brv} UZS.',
    recyclingStandardOld:
      'The {cc} cc engine determines the displacement band; at {ageMonths} months, the over-36-month band selects recycling coefficient {coefficient}. Multiply by the reference basic calculation value (BRV) of {brv} UZS.',
    recyclingElectricYoung:
      'For a BEV aged {ageMonths} months, use the electric up-to-36-month band, with recycling coefficient {coefficient}. Multiply by the reference basic calculation value (BRV) of {brv} UZS.',
    recyclingElectricOld:
      'For a BEV aged {ageMonths} months, use the electric over-36-month band, with recycling coefficient {coefficient}. Multiply by the reference basic calculation value (BRV) of {brv} UZS.',
  },
  ru: {
    dutyElectric:
      'Для электромобиля пошлина по текущей справочной схеме равна нулю; НДС, утилизация и регистрация рассчитываются отдельно.',
    vat: 'База НДС: автомобиль и указанные перевозка со страховкой {value} UZS + неокруглённая пошлина {duty} UZS = {base} UZS; сбор за оформление, утилизация и регистрация в базу не входят. Применяется ставка {percentage}% с округлением до целых UZS.',
    registrationElectric:
      'Для регистрации электромобиля применяется коэффициент {coefficient}, умноженный на справочную базовую расчётную величину (БРВ) {brv} UZS.',
    registrationStandard:
      'Для регистрации автомобилей с ДВС и гибридов применяется коэффициент {coefficient}, умноженный на справочную базовую расчётную величину (БРВ) {brv} UZS.',
    customsFee:
      'Таможенная стоимость автомобиля с указанными перевозкой и страховкой равна {customsUsd} USD и попадает в диапазон свыше {lower} до {upper} USD включительно, коэффициент {coefficient}. Он умножается на справочную базовую расчётную величину (БРВ) {brv} UZS.',
    customsFeeTop:
      'Таможенная стоимость автомобиля с указанными перевозкой и страховкой равна {customsUsd} USD и попадает в диапазон свыше {lower} USD, коэффициент {coefficient}. Он умножается на справочную базовую расчётную величину (БРВ) {brv} UZS.',
    dutyHybridNewYoung:
      'Незарегистрированному гибриду {ageMonths} мес., не более 12: применяется пониженная ставка для нового гибрида без доплаты за см³. К таможенной стоимости {customsUsd} USD применяется {percentage}%, затем сумма переводится по курсу {usdRate} UZS/USD и округляется.',
    dutyHybridNewOld:
      'Незарегистрированному гибриду {ageMonths} мес., более 12: применяется повышенная ставка для нового гибрида без доплаты за см³. К таможенной стоимости {customsUsd} USD применяется {percentage}%, затем сумма переводится по курсу {usdRate} UZS/USD и округляется.',
    dutyHybridUsedYoung:
      'Подержанному гибриду {ageMonths} мес., не более 36: применяется пониженная процентная ставка и доплата по диапазону объёма двигателя. К таможенной стоимости {customsUsd} USD применяется {percentage}%, прибавляется {cc} см³ × {perCc} USD/см³, затем сумма переводится по курсу {usdRate} UZS/USD и округляется.',
    dutyHybridUsedOld:
      'Подержанному гибриду {ageMonths} мес., более 36: применяется повышенная процентная ставка и доплата за см³. К таможенной стоимости {customsUsd} USD применяется {percentage}%, прибавляется {cc} см³ × {perCc} USD/см³, затем сумма переводится по курсу {usdRate} UZS/USD и округляется.',
    dutyUsed:
      'Для зарегистрированного автомобиля с ДВС применяется тариф подержанных авто; возраст {ageMonths} мес. не переводит его в категорию новых незарегистрированных автомобилей. К таможенной стоимости {customsUsd} USD применяется {percentage}%, прибавляется {cc} см³ × {perCc} USD/см³, затем сумма переводится по курсу {usdRate} UZS/USD и округляется.',
    dutyNewYoung:
      'Незарегистрированному автомобилю с ДВС {ageMonths} мес., не более 12: применяется пониженная ставка для новых авто и соответствующий диапазон объёма бензинового/дизельного двигателя. К таможенной стоимости {customsUsd} USD применяется {percentage}%, прибавляется {cc} см³ × {perCc} USD/см³, затем сумма переводится по курсу {usdRate} UZS/USD и округляется.',
    dutyNewOld:
      'Незарегистрированному автомобилю с ДВС {ageMonths} мес., более 12: применяется повышенная ставка для новых авто и соответствующий диапазон объёма бензинового/дизельного двигателя. К таможенной стоимости {customsUsd} USD применяется {percentage}%, прибавляется {cc} см³ × {perCc} USD/см³, затем сумма переводится по курсу {usdRate} UZS/USD и округляется.',
    recyclingStandardYoung:
      'Объём {cc} см³ определяет диапазон таблицы; при возрасте {ageMonths} мес. применяется диапазон до 36 месяцев включительно, коэффициент {coefficient}. Он умножается на справочную БРВ {brv} UZS.',
    recyclingStandardOld:
      'Объём {cc} см³ определяет диапазон таблицы; при возрасте {ageMonths} мес. применяется диапазон свыше 36 месяцев, коэффициент {coefficient}. Он умножается на справочную БРВ {brv} UZS.',
    recyclingElectricYoung:
      'Электромобилю {ageMonths} мес.: применяется электрический диапазон до 36 месяцев включительно с утилизационным коэффициентом {coefficient}. Он умножается на справочную БРВ {brv} UZS.',
    recyclingElectricOld:
      'Электромобилю {ageMonths} мес.: применяется электрический диапазон свыше 36 месяцев с утилизационным коэффициентом {coefficient}. Он умножается на справочную БРВ {brv} UZS.',
  },
} as const;
