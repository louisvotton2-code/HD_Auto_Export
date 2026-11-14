import type { Locale } from '@/i18n/routing';

type RecordsCopy = {
  vin: string;
  vehicleClass: string;
  exportStatus: string;
  exportStatuses: Record<'eligible' | 'restricted' | 'unknown', string>;
  report: string;
  viewReport: string;
  reportUnavailable: string;
  reportAbsent: string;
  reportPending: string;
  reportUnknown: string;
  reportEmpty: string;
  priceHistory: string;
  priceDate: string;
  priceAmount: string;
  priceCurrency: string;
  noPriceHistory: string;
  viewPriceHistory: string;
  unknownDate: string;
  enableDetails: string;
  originalCurrency: string;
  loading: string;
  loadMore: string;
  retry: string;
  reload: string;
  error: string;
  changed: string;
  retryIn: string;
};

export const publicVehicleRecordsCopy = {
  zh: {
    vin: '车辆识别码 VIN',
    vehicleClass: '车身级别',
    exportStatus: '出口条件',
    exportStatuses: { eligible: '符合出口条件', restricted: '出口受限', unknown: '出口条件未确认' },
    report: '车辆检测报告',
    viewReport: '查看检测报告',
    reportUnavailable: '检测报告暂时无法获取，请稍后重试。',
    reportAbsent: '该车源没有检测报告。',
    reportPending: '检测报告资料正在补齐。',
    reportUnknown: '暂未提供检测报告状态。',
    reportEmpty: '检测报告暂无分项记录。',
    priceHistory: '价格历史',
    priceDate: '记录时间（UTC）',
    priceAmount: '报价',
    priceCurrency: '原始币种',
    noPriceHistory: '暂无价格历史记录。',
    viewPriceHistory: '查看价格历史',
    unknownDate: '记录时间未提供',
    enableDetails: '启用 JavaScript 后可读取更多车辆资料。',
    originalCurrency: '历史报价使用记录时的原始币种，未按当前汇率折算。',
    loading: '正在加载…',
    loadMore: '继续加载',
    retry: '重试',
    reload: '重新读取',
    error: '暂时无法加载，请重试。',
    changed: '车辆资料已有更新，请重新读取本节。',
    retryIn: '{seconds} 秒后可重试',
  },
  en: {
    vin: 'Vehicle identification number (VIN)',
    vehicleClass: 'Vehicle class',
    exportStatus: 'Export conditions',
    exportStatuses: { eligible: 'Eligible for export', restricted: 'Export restricted', unknown: 'Export conditions unconfirmed' },
    report: 'Vehicle inspection report',
    viewReport: 'View inspection report',
    reportUnavailable: 'The inspection report is temporarily unavailable. Please try again later.',
    reportAbsent: 'This listing has no inspection report.',
    reportPending: 'Inspection report details are being prepared.',
    reportUnknown: 'The inspection report status has not been provided.',
    reportEmpty: 'No itemized inspection records are available in this report.',
    priceHistory: 'Price history',
    priceDate: 'Recorded at (UTC)',
    priceAmount: 'Quoted price',
    priceCurrency: 'Original currency',
    noPriceHistory: 'No price history is available.',
    viewPriceHistory: 'View price history',
    unknownDate: 'Recording time not provided',
    enableDetails: 'Enable JavaScript to load more vehicle information.',
    originalCurrency: 'Historical quotes retain their original currency and are not converted using current exchange rates.',
    loading: 'Loading…',
    loadMore: 'Load more',
    retry: 'Retry',
    reload: 'Reload',
    error: 'This information could not be loaded. Please try again.',
    changed: 'The vehicle information has changed. Reload this section.',
    retryIn: 'Retry in {seconds} seconds',
  },
  ru: {
    vin: 'Идентификационный номер (VIN)',
    vehicleClass: 'Класс автомобиля',
    exportStatus: 'Условия экспорта',
    exportStatuses: { eligible: 'Допущен к экспорту', restricted: 'Экспорт ограничен', unknown: 'Условия экспорта не подтверждены' },
    report: 'Отчёт об осмотре автомобиля',
    viewReport: 'Посмотреть отчёт об осмотре',
    reportUnavailable: 'Отчёт об осмотре временно недоступен. Попробуйте позже.',
    reportAbsent: 'Для этого автомобиля нет отчёта об осмотре.',
    reportPending: 'Данные отчёта об осмотре дополняются.',
    reportUnknown: 'Статус отчёта об осмотре пока не указан.',
    reportEmpty: 'Подробные записи об осмотре в отчёте отсутствуют.',
    priceHistory: 'История цены',
    priceDate: 'Дата записи (UTC)',
    priceAmount: 'Цена предложения',
    priceCurrency: 'Исходная валюта',
    noPriceHistory: 'Записи об истории цены отсутствуют.',
    viewPriceHistory: 'Посмотреть историю цены',
    unknownDate: 'Время записи не указано',
    enableDetails: 'Включите JavaScript, чтобы загрузить дополнительные данные автомобиля.',
    originalCurrency: 'Исторические цены указаны в исходной валюте без пересчёта по текущему курсу.',
    loading: 'Загрузка…',
    loadMore: 'Загрузить ещё',
    retry: 'Повторить',
    reload: 'Загрузить заново',
    error: 'Не удалось загрузить данные. Попробуйте ещё раз.',
    changed: 'Данные автомобиля изменились. Загрузите этот раздел заново.',
    retryIn: 'Повторить через {seconds} с',
  },
} satisfies Record<Locale, RecordsCopy>;
