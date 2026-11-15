import type { Locale } from '@/i18n/routing';

type Copy = {
  title: string; current: string; checked: string; faults: string;
  service: string; unavailable: string; application: string; mismatch: string;
  merchant: string; match: string; customer: string; period: string;
  conclusions: string; defects: string; normal: string; normalNote: string; language: string;
  unknownLanguage: string; contact: string; more: string;
  outcomes: Record<'ok' | 'defect' | 'unknown', string>;
};
export const inspectionSummaryCopy = {
  zh: {
    title: '车辆检测摘要', current: '以下为已存检测结论，不代表历史事故或过户次数。',
    checked: '检查项', faults: '异常项', service: '车辆检测服务',
    unavailable: '该车源暂无可查看的历史检测报告。', application: '支付定金后，可申请车辆检测。',
    mismatch: '若检测确认车辆与约定描述不符，定金全额退还，检测费用由', merchant: '商家承担',
    match: '若与约定描述相符，60 美元检测费由', customer: '客户承担', period: '。',
    conclusions: '主要结论', defects: '异常说明', normal: '已存正常明细',
    normalNote: '此数量仅指本站已存正常明细，不等同全报告正常检查总数。', language: '报告正文语言',
    unknownLanguage: '按各项原文语言显示', contact: '详细检测报告请联系销售人员。', more: '更多检测内容请联系销售人员。',
    outcomes: { ok: '未发现异常', defect: '发现异常', unknown: '未提供结论' },
  },
  en: {
    title: 'Vehicle inspection summary', current: 'These are stored inspection findings, not counts of past accidents or ownership changes.',
    checked: 'Items checked', faults: 'Issues found', service: 'Vehicle inspection service',
    unavailable: 'No historical inspection report is currently available for this listing.', application: 'A vehicle inspection can be requested after the deposit is paid.',
    mismatch: 'If the inspection confirms a difference from the agreed description, the deposit is refunded in full and the inspection fee is ', merchant: 'paid by the seller',
    match: 'If the vehicle matches the agreed description, the USD 60 inspection fee is ', customer: 'paid by the customer', period: '.',
    conclusions: 'Main findings', defects: 'Issues by vehicle part', normal: 'Stored normal records',
    normalNote: 'This is the number of normal records stored here, not the complete report’s normal check count.', language: 'Report language',
    unknownLanguage: 'Original language shown for each item', contact: 'Please contact sales for the detailed inspection report.', more: 'Contact sales for further inspection details.',
    outcomes: { ok: 'No issues found', defect: 'Issues found', unknown: 'Conclusion not provided' },
  },
  ru: {
    title: 'Результаты осмотра автомобиля', current: 'Это сохранённые выводы осмотра, а не количество ДТП или смен владельцев в прошлом.',
    checked: 'Проверено пунктов', faults: 'Выявлено замечаний', service: 'Услуга осмотра автомобиля',
    unavailable: 'Для этого объявления сейчас нет доступного исторического отчёта об осмотре.', application: 'Осмотр автомобиля можно заказать после внесения задатка.',
    mismatch: 'Если осмотр подтвердит несоответствие согласованному описанию, задаток возвращается полностью, а осмотр ', merchant: 'оплачивает продавец',
    match: 'Если автомобиль соответствует согласованному описанию, осмотр стоимостью 60 USD ', customer: 'оплачивает клиент', period: '.',
    conclusions: 'Основные выводы', defects: 'Замечания по частям автомобиля', normal: 'Сохранённые записи без замечаний',
    normalNote: 'Это число сохранённых записей без замечаний, а не всех проверок полного отчёта.', language: 'Язык отчёта',
    unknownLanguage: 'Для каждого пункта указан язык оригинала', contact: 'Подробный отчёт об осмотре предоставит отдел продаж.', more: 'За дополнительными результатами осмотра обратитесь в отдел продаж.',
    outcomes: { ok: 'Замечаний не выявлено', defect: 'Выявлены замечания', unknown: 'Вывод не предоставлен' },
  },
} satisfies Record<Locale, Copy>;
