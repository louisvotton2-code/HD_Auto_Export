import type { Locale } from '@/i18n/routing';

type Copy = {
  title: string;
  registrationStatus: string;
  images: string;
  specifications: string;
  inspection: string;
  report: string;
  requestReport: string;
  requestReportMessage: string;
  originalReport: string;
  moreInspection: string;
  needsConfirmation: string;
};

export const externalDetailCopy = {
  zh: {
    title: '车辆名称',
    registrationStatus: '登记状态',
    images: '车辆照片',
    specifications: '车辆配置',
    inspection: '车辆检测报告',
    report: '查看车辆报告',
    requestReport: '联系获取车辆检测报告',
    requestReportMessage: '你好，请提供这辆车的车辆检测报告。',
    originalReport: '打开原始检测报告',
    moreInspection: '更多检测项目',
    needsConfirmation: '以下资料需进一步确认',
  },
  en: {
    title: 'Vehicle name',
    registrationStatus: 'Registration status',
    images: 'Vehicle photos',
    specifications: 'Equipment and specifications',
    inspection: 'Vehicle inspection report',
    report: 'View vehicle report',
    requestReport: 'Contact us for the vehicle inspection report',
    requestReportMessage: 'Hello, please send me the inspection report for this vehicle.',
    originalReport: 'Open the original inspection report',
    moreInspection: 'More inspection items',
    needsConfirmation: 'Information to confirm',
  },
  ru: {
    title: 'Название автомобиля',
    registrationStatus: 'Статус регистрации',
    images: 'Фотографии автомобиля',
    specifications: 'Комплектация и характеристики',
    inspection: 'Отчёт об осмотре автомобиля',
    report: 'Посмотреть отчёт об автомобиле',
    requestReport: 'Запросить отчёт об осмотре автомобиля',
    requestReportMessage: 'Здравствуйте! Пожалуйста, пришлите отчёт об осмотре этого автомобиля.',
    originalReport: 'Открыть оригинал отчёта об осмотре',
    moreInspection: 'Другие пункты осмотра',
    needsConfirmation: 'Данные для уточнения',
  },
} satisfies Record<Locale, Copy>;
