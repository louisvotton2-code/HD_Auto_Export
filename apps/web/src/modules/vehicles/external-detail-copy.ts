import type { Locale } from '@/i18n/routing';

type Copy = {
  comparison: string;
  original: string;
  displayed: string;
  title: string;
  registrationStatus: string;
  images: string;
  specifications: string;
  inspection: string;
  report: string;
  related: string;
  listing: (number: number) => string;
  needsConfirmation: string;
};

export const externalDetailCopy = {
  zh: {
    comparison: '查看原文与当前显示',
    original: '原文',
    displayed: '当前显示',
    title: '车辆名称',
    registrationStatus: '登记状态',
    images: '车辆照片',
    specifications: '车辆配置',
    inspection: '检测资料',
    report: '查看检测报告',
    related: '关联挂牌',
    listing: (number) => `查看挂牌 ${number}`,
    needsConfirmation: '以下资料需进一步确认',
  },
  en: {
    comparison: 'Compare original and displayed text',
    original: 'Original text',
    displayed: 'Displayed text',
    title: 'Vehicle name',
    registrationStatus: 'Registration status',
    images: 'Vehicle photos',
    specifications: 'Equipment and specifications',
    inspection: 'Inspection information',
    report: 'View inspection report',
    related: 'Related listings',
    listing: (number) => `View listing ${number}`,
    needsConfirmation: 'Information to confirm',
  },
  ru: {
    comparison: 'Сравнить исходный и отображаемый текст',
    original: 'Исходный текст',
    displayed: 'Отображаемый текст',
    title: 'Название автомобиля',
    registrationStatus: 'Статус регистрации',
    images: 'Фотографии автомобиля',
    specifications: 'Комплектация и характеристики',
    inspection: 'Данные осмотра',
    report: 'Открыть отчёт об осмотре',
    related: 'Связанные объявления',
    listing: (number) => `Открыть объявление ${number}`,
    needsConfirmation: 'Данные для уточнения',
  },
} satisfies Record<Locale, Copy>;
