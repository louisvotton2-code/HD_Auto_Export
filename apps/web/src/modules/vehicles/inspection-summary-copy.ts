import type { Locale } from '@/i18n/routing';

export const inspectionSummaryCopy = {
  zh: { title: '车辆检测摘要', current: '以下为本次检测结论，不代表历史事故或过户次数。', checked: '检查项', faults: '异常项', notProvided: '未提供', view: '查看检测报告', service: '车辆检测服务',
    unavailable: '该车源暂无可查看的历史检测报告。', application: '支付定金后，可联系销售申请车辆检测。',
    mismatch: '若检测确认车辆与约定描述不符，定金全额退还，客户无需承担检测费用；', match: '若与约定描述相符，检测费用由客户承担。',
    outcomes: { ok: '未发现异常', defect: '发现异常', unknown: '未提供结论' } },
  en: { title: 'Vehicle inspection summary', current: 'These are findings from this inspection, not counts of past accidents or ownership changes.', checked: 'Items checked', faults: 'Issues found', notProvided: 'Not provided', view: 'View inspection report', service: 'Vehicle inspection service',
    unavailable: 'No historical inspection report is currently available for this listing.', application: 'After paying the deposit, contact sales to request a vehicle inspection.',
    mismatch: 'If the inspection confirms that the vehicle differs from the agreed description, the deposit will be refunded in full and the customer will not pay the inspection fee.', match: 'If the vehicle matches the agreed description, the customer pays the inspection fee.',
    outcomes: { ok: 'No issues found', defect: 'Issues found', unknown: 'Conclusion not provided' } },
  ru: { title: 'Результаты осмотра автомобиля', current: 'Это выводы данного осмотра, а не количество ДТП или смен владельцев в прошлом.', checked: 'Проверено пунктов', faults: 'Выявлено замечаний', notProvided: 'Не предоставлено', view: 'Посмотреть отчёт об осмотре', service: 'Услуга осмотра автомобиля',
    unavailable: 'Для этого объявления сейчас нет доступного исторического отчёта об осмотре.', application: 'После внесения задатка свяжитесь с отделом продаж, чтобы заказать осмотр автомобиля.',
    mismatch: 'Если осмотр подтвердит несоответствие автомобиля согласованному описанию, задаток возвращается полностью, а клиент не оплачивает осмотр.', match: 'Если автомобиль соответствует согласованному описанию, осмотр оплачивает клиент.',
    outcomes: { ok: 'Замечаний не выявлено', defect: 'Выявлены замечания', unknown: 'Вывод не предоставлен' } },
} satisfies Record<Locale, { title: string; current: string; checked: string; faults: string; notProvided: string; view: string; service: string; unavailable: string; application: string; mismatch: string; match: string; outcomes: Record<'ok' | 'defect' | 'unknown', string> }>;
