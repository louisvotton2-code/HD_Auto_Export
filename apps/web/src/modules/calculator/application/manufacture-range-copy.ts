import type { Locale } from '@/i18n/routing';
import type { ManufactureRangeCalculation } from './manufacture-range';

export const manufactureRangeCopy = {
  zh: {
    january: '生产月份未填，按最近六年各年 1 月测算',
    januaryPeriod: '（{from} 至 {to}，共 {count} 种情形）。',
    unavailable: '该生产日期范围尚不能完整报价，请补充或核对下方车辆资料。不能计算的月份不会被省略后当作完整区间。',
    minimum: '最低费用', maximum: '最高费用',
    sameTotal: '六个生产月份的测算费用相同。',
    month: '生产月份', sameInputs: '两套明细使用相同清关日期、车价和汇率，分别保留对应月份的完整计算结果。',
    suppliedPower: '已使用车辆资料中的 hp；不同类型的功率不作混用。',
  },
  en: {
    january: 'No manufacture month selected. The estimate uses January of each of the last six years',
    januaryPeriod: ' ({from} to {to}, {count} scenarios).',
    unavailable: 'A complete quote is not yet available for this manufacture range. Complete or check the vehicle details below. Unpriced months are not silently excluded from the bounds.',
    minimum: 'Lowest cost', maximum: 'Highest cost',
    sameTotal: 'The estimated cost is the same for all six manufacture months.',
    month: 'Manufacture month', sameInputs: 'Both complete breakdowns use the same clearance date, vehicle price and exchange rates, with the manufacture month shown for each scenario.',
    suppliedPower: 'Uses the hp supplied in the vehicle details; different power measurements are not mixed.',
  },
  ru: {
    january: 'Месяц выпуска не указан. Расчёт выполнен для января каждого из последних шести лет',
    januaryPeriod: ' ({from} — {to}, {count} вариантов).',
    unavailable: 'Полный расчёт для этого диапазона пока недоступен. Дополните или проверьте данные автомобиля ниже. Месяцы без расчёта не исключаются из границ незаметно.',
    minimum: 'Минимальные расходы', maximum: 'Максимальные расходы',
    sameTotal: 'Для всех шести месяцев выпуска расчётная стоимость одинакова.',
    month: 'Месяц производства', sameInputs: 'Оба полных расчёта используют одинаковые дату оформления, цену автомобиля и курсы, с указанным месяцем производства для каждого варианта.',
    suppliedPower: 'Используются л. с. из данных автомобиля; разные виды мощности не смешиваются.',
  },
} as const;

export function januaryRangeNote(locale: Locale, calculation: ManufactureRangeCalculation) {
  const copy = manufactureRangeCopy[locale];
  const period = copy.januaryPeriod
    .replace('{from}', calculation.range.from)
    .replace('{to}', calculation.range.to)
    .replace('{count}', calculation.evaluatedMonths.toLocaleString(locale));
  return { lead: copy.january, period };
}
