/** Localized descriptions; threshold decisions remain entirely in the policy. */
export const alMethodMessages = {
  zh: {
    duty: '本参考采用个人乘用车进口口径，关税按 0 计；这不代表增值税、注册费或豪车税也为 0。',
    excise: '本参考口径对本类乘用车不另计消费税，因此本项为 0；增值税和豪车税另行判断。',
    vatElectric:
      '纯电不使用燃油车排量最低估值，计税基数为车价加已填运保换算取整后的申报价值 {declared} ALL。乘 {rate}% 后四舍五入至整数 ALL。',
    vatDeclared:
      '排量 {cc} cc 对应最低估值 {minimum} ALL；申报价值（车价加已填运保换算取整）为 {declared} ALL，不低于最低估值，因此税基采用 {taxableBase} ALL。乘 {rate}% 后四舍五入至整数 ALL。',
    vatMinimum:
      '排量 {cc} cc 对应最低估值 {minimum} ALL；申报价值（车价加已填运保换算取整）为 {declared} ALL，低于最低估值，因此税基提高至 {taxableBase} ALL。乘 {rate}% 后四舍五入至整数 ALL。',
    registration:
      '采用参考站的固定注册费用估算 {fee} ALL，计入上方进口费用合计；实际收费仍以办理机构为准。',
    luxuryDisplacement:
      '本车非纯电，排量 {cc} cc 达到 3,000 cc 门槛，触发一次性豪车税 {fee} ALL；价值门槛无需同时满足。',
    luxuryValue:
      '本车增值税计税价值 {taxableBase} ALL 达到 5,000,000 ALL 门槛，触发一次性豪车税 {fee} ALL；排量门槛无需同时满足。',
    luxuryBelow:
      '排量 {cc} cc 低于 3,000 cc，且增值税计税价值 {taxableBase} ALL 低于 5,000,000 ALL；两项门槛都未达到，因此一次性豪车税为 0。',
    luxuryElectricBelow:
      '纯电不使用排量豪车门槛；增值税计税价值 {taxableBase} ALL 低于 5,000,000 ALL，因此一次性豪车税为 0。',
    annualLuxury:
      '车辆已触发豪车条件，另有每年 {fee} ALL 的参考年度豪车税。它是后续年度支出，未计入上方一次性进口费用合计。',
  },
  en: {
    duty: 'This reference uses the personal passenger-car import treatment with zero customs duty. VAT, registration and luxury tax are assessed separately and may still be payable.',
    excise:
      'This reference treatment adds no separate excise charge for this passenger-car category, so this line is zero; VAT and luxury tax are assessed separately.',
    vatElectric:
      'BEVs do not use the combustion displacement minimum; the base is declared value ALL {declared}, obtained by converting the price plus supplied freight and insurance and rounding to whole ALL. Apply {rate}% and round to whole ALL.',
    vatDeclared:
      'The {cc} cc engine selects a minimum value of ALL {minimum}; declared value, including supplied freight and insurance after conversion and whole-ALL rounding, is ALL {declared}, at least that minimum, so use ALL {taxableBase}. Apply {rate}% and round to whole ALL.',
    vatMinimum:
      'The {cc} cc engine selects a minimum value of ALL {minimum}; declared value, including supplied freight and insurance after conversion and whole-ALL rounding, is ALL {declared}, below that minimum, so raise the base to ALL {taxableBase}. Apply {rate}% and round to whole ALL.',
    registration:
      'Use the reference site’s fixed registration estimate of ALL {fee}, included in the import-fee total above. The administering authority determines the actual charge.',
    luxuryDisplacement:
      'The non-BEV engine is {cc} cc, reaching the 3,000 cc threshold and triggering one-time luxury tax of ALL {fee}. The value threshold need not also be met.',
    luxuryValue:
      'The VAT value of ALL {taxableBase} reaches the ALL 5,000,000 threshold and triggers one-time luxury tax of ALL {fee}. The displacement threshold need not also be met.',
    luxuryBelow:
      'The {cc} cc engine is below 3,000 cc and the VAT value of ALL {taxableBase} is below ALL 5,000,000. Neither threshold is met, so one-time luxury tax is zero.',
    luxuryElectricBelow:
      'BEVs do not use the displacement luxury threshold; the VAT value of ALL {taxableBase} is below ALL 5,000,000, so one-time luxury tax is zero.',
    annualLuxury:
      'The vehicle meets a luxury threshold, so a separate reference annual luxury tax of ALL {fee} applies. This is an ongoing annual expense and is excluded from the one-time import-fee total above.',
  },
  ru: {
    duty: 'Применяется справочная схема личного ввоза легкового автомобиля с нулевой таможенной пошлиной. НДС, регистрация и налог на роскошь проверяются отдельно и могут подлежать уплате.',
    excise:
      'По этой справочной схеме для данной категории легковых автомобилей отдельный акциз не начисляется, поэтому строка равна 0; НДС и налог на роскошь проверяются отдельно.',
    vatElectric:
      'Для электромобиля не применяется минимальная оценка по объёму ДВС; база — заявленная стоимость {declared} ALL, полученная переводом цены с указанными перевозкой и страховкой и округлением до целого ALL. Применяется {rate}%, результат округляется до целого ALL.',
    vatDeclared:
      'Объём {cc} см³ соответствует минимальной оценке {minimum} ALL; заявленная стоимость с указанными перевозкой и страховкой после перевода и округления составляет {declared} ALL и не ниже минимума, поэтому база — {taxableBase} ALL. Применяется {rate}%, результат округляется до целого ALL.',
    vatMinimum:
      'Объём {cc} см³ соответствует минимальной оценке {minimum} ALL; заявленная стоимость с указанными перевозкой и страховкой после перевода и округления составляет {declared} ALL и ниже минимума, поэтому база повышается до {taxableBase} ALL. Применяется {rate}%, результат округляется до целого ALL.',
    registration:
      'Используется фиксированная оценка регистрации сайта-образца: {fee} ALL, включённая в итог импортных платежей выше. Фактическую сумму определяет орган регистрации.',
    luxuryDisplacement:
      'Автомобиль не является электромобилем; объём {cc} см³ достигает порога 3 000 см³, поэтому разовый налог на роскошь составляет {fee} ALL. Одновременное достижение стоимостного порога не требуется.',
    luxuryValue:
      'Стоимость для НДС {taxableBase} ALL достигает порога 5 000 000 ALL, поэтому разовый налог на роскошь составляет {fee} ALL. Одновременное достижение порога объёма не требуется.',
    luxuryBelow:
      'Объём {cc} см³ ниже 3 000 см³, а стоимость для НДС {taxableBase} ALL ниже 5 000 000 ALL. Оба порога не достигнуты, поэтому разовый налог на роскошь равен 0.',
    luxuryElectricBelow:
      'Для электромобиля не применяется порог объёма двигателя; стоимость для НДС {taxableBase} ALL ниже 5 000 000 ALL, поэтому разовый налог на роскошь равен 0.',
    annualLuxury:
      'Автомобиль соответствует условиям роскоши, поэтому отдельно указан справочный ежегодный налог {fee} ALL. Это последующий ежегодный расход, не включённый в итог разовых импортных платежей выше.',
  },
} as const;
