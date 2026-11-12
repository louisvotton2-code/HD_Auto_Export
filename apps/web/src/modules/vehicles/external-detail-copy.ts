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
  moreInspection: string;
  needsConfirmation: string;
  inspectionChecks: string;
  inspectionDefects: string;
  findingCount: string;
  inspectionStatus: string;
  inspectionOk: string;
  inspectionIssue: string;
  inspectionUnknown: string;
  showMoreInspection: string;
  inspectionEnableDetails: string;
};

export const externalDetailCopy = {
  zh: {
    title: '车辆名称',
    registrationStatus: '登记状态',
    images: '车辆照片',
    specifications: '车辆配置',
    inspection: '车辆检测信息',
    report: '查看检测项目',
    requestReport: '详细报告请联系销售人员获取',
    requestReportMessage: '你好，请提供这辆车的车辆检测报告。',
    moreInspection: '更多检测项目',
    needsConfirmation: '以下资料需进一步确认',
    inspectionChecks: '检查项目',
    inspectionDefects: '检测缺陷',
    findingCount: '缺陷项数',
    inspectionStatus: '检查判定',
    inspectionOk: '通过',
    inspectionIssue: '未通过',
    inspectionUnknown: '未提供',
    showMoreInspection: '继续展开',
    inspectionEnableDetails: '启用 JavaScript 后可展开查看分项检测内容。',
  },
  en: {
    title: 'Vehicle name',
    registrationStatus: 'Registration status',
    images: 'Vehicle photos',
    specifications: 'Equipment and specifications',
    inspection: 'Vehicle inspection details',
    report: 'View inspection details',
    requestReport: 'Contact our sales team for the detailed report',
    requestReportMessage: 'Hello, please send me the inspection report for this vehicle.',
    moreInspection: 'More inspection items',
    needsConfirmation: 'Information to confirm',
    inspectionChecks: 'Inspection checks',
    inspectionDefects: 'Recorded inspection findings',
    findingCount: 'Findings',
    inspectionStatus: 'Check outcome',
    inspectionOk: 'Passed',
    inspectionIssue: 'Not passed',
    inspectionUnknown: 'Not provided',
    showMoreInspection: 'Show more',
    inspectionEnableDetails: 'Enable JavaScript to view the itemized inspection details.',
  },
  ru: {
    title: 'Название автомобиля',
    registrationStatus: 'Статус регистрации',
    images: 'Фотографии автомобиля',
    specifications: 'Комплектация и характеристики',
    inspection: 'Данные осмотра автомобиля',
    report: 'Посмотреть результаты осмотра',
    requestReport: 'Для получения подробного отчёта свяжитесь с отделом продаж',
    requestReportMessage: 'Здравствуйте! Пожалуйста, пришлите отчёт об осмотре этого автомобиля.',
    moreInspection: 'Другие пункты осмотра',
    needsConfirmation: 'Данные для уточнения',
    inspectionChecks: 'Проверенные элементы',
    inspectionDefects: 'Замечания при осмотре',
    findingCount: 'Замечаний',
    inspectionStatus: 'Результат проверки',
    inspectionOk: 'Пройдено',
    inspectionIssue: 'Не пройдено',
    inspectionUnknown: 'Не указано',
    showMoreInspection: 'Показать ещё',
    inspectionEnableDetails: 'Включите JavaScript, чтобы просмотреть подробные результаты осмотра.',
  },
} satisfies Record<Locale, Copy>;
