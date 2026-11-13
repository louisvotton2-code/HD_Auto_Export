export const manufactureRangeCopy = {
  zh: {
    source: '生产月份范围：{from} 至 {to}。已逐月核算 {count} 种情形；输入精确生产月份可查看单一报价。',
    unavailable: '该生产日期范围尚不能完整报价，请补充或核对下方车辆资料。不能计算的月份不会被省略后当作完整区间。',
    minimum: '较低费用情形', maximum: '较高费用情形',
    month: '生产月份', sameInputs: '两套明细使用相同清关日期、车价和汇率，分别保留对应月份的完整计算结果。',
    suppliedPower: '已使用车辆资料中的 hp；不同类型的功率不作混用。',
  },
  en: {
    source: 'Manufacture month range: {from} to {to}. Every month was checked ({count} scenarios). Enter an exact manufacture month for a single estimate.',
    unavailable: 'A complete quote is not yet available for this manufacture range. Complete or check the vehicle details below. Unpriced months are not silently excluded from the bounds.',
    minimum: 'Lower-cost scenario', maximum: 'Higher-cost scenario',
    month: 'Manufacture month', sameInputs: 'Both complete breakdowns use the same clearance date, vehicle price and exchange rates, with the manufacture month shown for each scenario.',
    suppliedPower: 'Uses the hp supplied in the vehicle details; different power measurements are not mixed.',
  },
  ru: {
    source: 'Диапазон месяцев производства: {from} — {to}. Проверен каждый месяц ({count} вариантов). Укажите точный месяц для единого расчёта.',
    unavailable: 'Полный расчёт для этого диапазона пока недоступен. Дополните или проверьте данные автомобиля ниже. Месяцы без расчёта не исключаются из границ незаметно.',
    minimum: 'Вариант с меньшими расходами', maximum: 'Вариант с большими расходами',
    month: 'Месяц производства', sameInputs: 'Оба полных расчёта используют одинаковые дату оформления, цену автомобиля и курсы, с указанным месяцем производства для каждого варианта.',
    suppliedPower: 'Используются л. с. из данных автомобиля; разные виды мощности не смешиваются.',
  },
} as const;
