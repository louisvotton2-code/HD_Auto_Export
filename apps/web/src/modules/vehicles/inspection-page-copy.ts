import type { Locale } from '@/i18n/routing';

type Copy = {
  title: string; back: string; inquiry: string; vin: string; language: string; source: string;
  stored: string; overview: string; checked: string; faults: string; notProvided: string;
  categories: string; all: string; allResults: string; outcome: string; apply: string; part: string;
  conclusions: string; findings: string; loadedFindings: string; noLoadedFindings: string;
  details: string; item: string; result: string; noItems: string; detailsCount: string;
  statuses: Record<'available' | 'no_report' | 'unavailable' | 'pending' | 'unknown', string>;
  outcomes: Record<'ok' | 'defect' | 'unknown', string>;
  loading: string; more: string; retry: string; changed: string; restart: string;
  error: string; missing: string; wait: string; noScript: string; fallbackGroup: string;
  contact: string; note: string; unknownLanguage: string;
};

export const inspectionPageCopy = {
  zh: {
    title: '车辆检测报告', back: '返回车辆详情', inquiry: '咨询编号', vin: 'VIN', language: '报告正文语言', source: '车源来源',
    stored: '本站已保存的检测资料', overview: '检测概览', checked: '检查项', faults: '异常项', notProvided: '未提供',
    categories: '检测分类', all: '全部分类', allResults: '全部结果', outcome: '检查结果', apply: '筛选明细', part: '部位',
    conclusions: '已有检测结论', findings: '异常摘要', loadedFindings: '以下为已加载的异常明细；完整报告统计见检测概览。',
    noLoadedFindings: '当前已加载的明细中没有标记为异常的项目。', details: '分类明细', item: '检查项目', result: '记录结果',
    noItems: '当前筛选下暂无可查看的分项记录。', detailsCount: '已加载 {loaded} 条 / 当前筛选共 {total} 条',
    statuses: { available: '已有可查看报告', no_report: '暂无可查看的历史检测报告', unavailable: '历史检测报告暂不可获取', pending: '报告资料待补齐', unknown: '暂无可查看的历史检测报告' },
    outcomes: { ok: '正常', defect: '异常', unknown: '未提供' }, loading: '正在读取报告…', more: '加载更多明细', retry: '重试读取',
    changed: '报告内容已更新，请重新读取，避免混合不同版本。', restart: '重新读取报告', error: '报告暂时无法读取，请重试。',
    missing: '此车辆或报告已无法公开查看。', wait: '{seconds} 秒后可重试',
    noScript: '首批明细和完整统计已显示。启用 JavaScript 后可继续加载后续明细；分类筛选仍可使用。',
    fallbackGroup: '检查记录', contact: '联系销售', note: '检查项、异常项和分类结论来自已有检测记录，不代表历史事故次数；未提供的信息不会按零项计算。',
    unknownLanguage: '正文语言未提供',
  },
  en: {
    title: 'Vehicle inspection report', back: 'Back to vehicle', inquiry: 'Inquiry reference', vin: 'VIN', language: 'Report language', source: 'Listing source',
    stored: 'Inspection information stored on this website', overview: 'Inspection overview', checked: 'Checks', faults: 'Findings', notProvided: 'Not provided',
    categories: 'Inspection categories', all: 'All categories', allResults: 'All results', outcome: 'Result', apply: 'Filter records', part: 'Part',
    conclusions: 'Recorded conclusions', findings: 'Findings summary', loadedFindings: 'These are the findings in the loaded records. Complete report statistics are shown in the overview.',
    noLoadedFindings: 'No loaded records are marked as a finding.', details: 'Detailed records', item: 'Inspection item', result: 'Recorded result',
    noItems: 'No itemized records are available for these filters.', detailsCount: '{loaded} records loaded / {total} records matching these filters',
    statuses: { available: 'Report available', no_report: 'No historical report is available to view', unavailable: 'The historical report is temporarily unavailable', pending: 'Report information is being prepared', unknown: 'No historical report is available to view' },
    outcomes: { ok: 'Normal', defect: 'Finding', unknown: 'Not provided' }, loading: 'Loading the report…', more: 'Load more records', retry: 'Retry loading',
    changed: 'The report has changed. Reload it to avoid combining different versions.', restart: 'Reload report', error: 'The report could not be loaded. Please retry.',
    missing: 'This vehicle or report is no longer publicly available.', wait: 'Retry in {seconds} seconds',
    noScript: 'The first records and complete statistics are shown. Enable JavaScript to load more records; category filters remain available.',
    fallbackGroup: 'Inspection records', contact: 'Contact sales', note: 'Check counts, findings and conclusions describe the recorded inspection, not historical accident counts. Missing information is not counted as zero.',
    unknownLanguage: 'Report language not provided',
  },
  ru: {
    title: 'Отчёт об осмотре автомобиля', back: 'Вернуться к автомобилю', inquiry: 'Номер для запроса', vin: 'VIN', language: 'Язык отчёта', source: 'Источник объявления',
    stored: 'Данные осмотра, сохранённые на этом сайте', overview: 'Обзор осмотра', checked: 'Проверено', faults: 'Замечания', notProvided: 'Не предоставлено',
    categories: 'Категории осмотра', all: 'Все категории', allResults: 'Все результаты', outcome: 'Результат', apply: 'Показать записи', part: 'Узел',
    conclusions: 'Зафиксированные выводы', findings: 'Выявленные замечания', loadedFindings: 'Здесь показаны замечания из загруженных записей. Полная статистика отчёта приведена в обзоре.',
    noLoadedFindings: 'В загруженных записях замечания не отмечены.', details: 'Подробные записи', item: 'Пункт проверки', result: 'Зафиксированный результат',
    noItems: 'Для выбранных условий подробные записи недоступны.', detailsCount: 'Загружено {loaded} записей / по выбранным условиям {total}',
    statuses: { available: 'Отчёт доступен', no_report: 'Исторический отчёт для просмотра недоступен', unavailable: 'Исторический отчёт временно недоступен', pending: 'Данные отчёта дополняются', unknown: 'Исторический отчёт для просмотра недоступен' },
    outcomes: { ok: 'Норма', defect: 'Замечание', unknown: 'Не предоставлено' }, loading: 'Загрузка отчёта…', more: 'Загрузить ещё записи', retry: 'Повторить загрузку',
    changed: 'Отчёт изменился. Загрузите его заново, чтобы не смешивать версии.', restart: 'Загрузить отчёт заново', error: 'Не удалось загрузить отчёт. Попробуйте ещё раз.',
    missing: 'Автомобиль или отчёт больше не доступен публично.', wait: 'Повторите через {seconds} с',
    noScript: 'Первые записи и полная статистика показаны. Для загрузки следующих записей включите JavaScript; фильтры категорий доступны без него.',
    fallbackGroup: 'Записи осмотра', contact: 'Связаться с продавцом', note: 'Количество проверок, замечания и выводы относятся к этому осмотру, а не к числу ДТП в истории. Отсутствующие сведения не считаются нулевыми.',
    unknownLanguage: 'Язык отчёта не указан',
  },
} satisfies Record<Locale, Copy>;
