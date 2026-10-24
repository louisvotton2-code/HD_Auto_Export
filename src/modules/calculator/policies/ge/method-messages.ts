export const geMethodMessages = {
  zh: {
    exciseElectric: '纯电在参考乘用车口径下免消费税，排量和舵位不增加该项税额。',
    exciseRight:
      '制造年份差为 {age} 年，排量由 {originalCc} cc 向上取整为 {cc} cc，适用基础税率 {baseRate} GEL/cc。右舵按基础额的 3 倍计，不叠加左舵混动优惠。',
    exciseHybridRelief:
      '制造年份差为 {age} 年，排量由 {originalCc} cc 向上取整为 {cc} cc，基础税率为 {baseRate} GEL/cc。左舵混动不超过 6 年，减免 60%，按基础额的 40% 计。',
    exciseStandard:
      '制造年份差为 {age} 年，排量由 {originalCc} cc 向上取整为 {cc} cc。按该年份档的 {baseRate} GEL/cc 计消费税，不采用额外舵位或混动减免。',
    importTaxElectric: '纯电在参考口径下不计这项进口税；仍需支付已列手续费用。',
    importTax:
      '按取整排量 {cc} cc 计税，每 cc 税率为 0.05 加年份差 {age} × 0.0025，合计 {rate} GEL/cc。',
    service:
      '固定手续费用合计 480 GEL：服务税 150、办理费 200、鉴定 30、申报 50、境内过境 50；不包含车辆和运输本金。',
    dutyZero:
      '参考乘用车口径中此项关税为 0；上方单列的“进口税”和消费税是其他费用，不能据此视为全部进口税费为 0。',
    vatZero: '参考乘用车口径中不另计 VAT，消费税、进口税和手续费用仍按各自明细计算。',
  },
  en: {
    exciseElectric:
      'Electric passenger cars have zero excise in this reference scenario; capacity and steering do not add excise.',
    exciseRight:
      'Calendar-year age is {age}. Capacity is rounded up from {originalCc} cc to {cc} cc at {baseRate} GEL/cc. Right-hand drive triples the base charge, without the left-hand hybrid reduction.',
    exciseHybridRelief:
      'Calendar-year age is {age}. Capacity is rounded up from {originalCc} cc to {cc} cc at {baseRate} GEL/cc. A left-hand hybrid up to 6 years receives a 60% reduction and pays 40% of the base.',
    exciseStandard:
      'Calendar-year age is {age}; capacity rounds up from {originalCc} cc to {cc} cc. Excise uses the age-band rate of {baseRate} GEL/cc, without a further steering or hybrid adjustment.',
    importTaxElectric:
      'The reference applies no import tax to electric cars; the listed administrative charges remain.',
    importTax:
      'Rounded capacity is {cc} cc. The per-cc rate is 0.05 plus calendar-year age {age} × 0.0025, giving {rate} GEL/cc.',
    service:
      'Fixed charges total 480 GEL: service tax 150, processing 200, appraisal 30, declaration 50 and internal transit 50. Vehicle and transport costs are separate.',
    dutyZero:
      'This reference passenger-car duty is zero. The separately listed import tax and excise are different charges, so total import payments are not necessarily zero.',
    vatZero:
      'No additional VAT is charged in this reference passenger-car scenario. Excise, import tax and administrative charges follow their own lines.',
  },
  ru: {
    exciseElectric:
      'В справочной схеме для легкового электромобиля акциз нулевой; объём и расположение руля его не увеличивают.',
    exciseRight:
      'Разница лет — {age}. Объём округлён вверх с {originalCc} до {cc} см³, базовая ставка — {baseRate} GEL/см³. Для правого руля сумма утраивается, без льготы леворульного гибрида.',
    exciseHybridRelief:
      'Разница лет — {age}. Объём округлён вверх с {originalCc} до {cc} см³, ставка — {baseRate} GEL/см³. Для леворульного гибрида не старше 6 лет действует снижение на 60%: к оплате 40% базовой суммы.',
    exciseStandard:
      'Разница лет — {age}; объём округлён вверх с {originalCc} до {cc} см³. Акциз рассчитан по возрастной ставке {baseRate} GEL/см³ без дополнительной поправки на руль или гибрид.',
    importTaxElectric:
      'Для электромобиля справочник не начисляет импортный налог; указанные административные сборы сохраняются.',
    importTax:
      'Расчётный объём — {cc} см³. Ставка на см³: 0,05 плюс разница лет {age} × 0,0025, итого {rate} GEL/см³.',
    service:
      'Фиксированные сборы — 480 GEL: сервисный налог 150, оформление 200, экспертиза 30, декларация 50 и внутренний транзит 50. Покупка и перевозка оплачиваются отдельно.',
    dutyZero:
      'Эта справочная пошлина на легковой автомобиль нулевая. Отдельные импортный налог и акциз — другие платежи, поэтому общий итог не обязательно равен нулю.',
    vatZero:
      'В справочной схеме для легкового автомобиля дополнительный НДС не начисляется. Акциз, импортный налог и административные сборы рассчитываются отдельно.',
  },
} as const;
