import type { DisplayText } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

type ConfigurationCopy = {
  missing: string;
  reviewed: string;
  unreviewed: string;
  language: string;
  provenance: Record<NonNullable<DisplayText['provenance']>, string>;
};

/** Metadata labels are used only in staff preview; public values retain the same display projection. */
export const configurationCopy = {
  zh: {
    missing: '未填写', reviewed: '已审核', unreviewed: '未审核', language: '内容语言',
    provenance: { original: '原文', catalog: '目录词条', machine: '机器翻译', human: '人工译文', supplier: '来源资料' },
  },
  en: {
    missing: 'Not entered', reviewed: 'Reviewed', unreviewed: 'Not reviewed', language: 'Content language',
    provenance: { original: 'Original text', catalog: 'Catalog label', machine: 'Machine translated', human: 'Human translated', supplier: 'Source information' },
  },
  ru: {
    missing: 'Не заполнено', reviewed: 'Проверено', unreviewed: 'Не проверено', language: 'Язык текста',
    provenance: { original: 'Исходный текст', catalog: 'Название из каталога', machine: 'Машинный перевод', human: 'Перевод человеком', supplier: 'Исходные данные' },
  },
} satisfies Record<Locale, ConfigurationCopy>;
