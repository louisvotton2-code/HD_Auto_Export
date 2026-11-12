import type { PublicationPreviewText } from '@hd/contracts/admin';
import type { Locale } from '@/i18n/routing';

type PreviewCopy = {
  draft: string;
  missing: string;
  missingTitle: string;
  missingPrice: string;
  missingImages: (count: number) => string;
  noImages: string;
  contentLanguage: string;
  imageAltTexts: string;
  conversionUnavailable: string;
  review: Record<PublicationPreviewText['reviewStatus'], string>;
  source: Record<NonNullable<PublicationPreviewText['kind']>, string>;
};

export const publicationPreviewCopy = {
  zh: {
    draft: '草稿预览',
    missing: '未填写',
    missingTitle: '标题未填写',
    missingPrice: '价格未填写',
    missingImages: (count) => `${count} 张图片尚未就绪`,
    noImages: '暂无已就绪图片',
    contentLanguage: '内容语言',
    imageAltTexts: '图片替代文本',
    conversionUnavailable: '美元换算暂不可用',
    review: { missing: '未填写', pending: '待审核', approved: '已审核', stale: '文本已过期' },
    source: { original: '原文', machine: '机器翻译', human: '人工译文', catalog: '目录词条' },
  },
  en: {
    draft: 'Draft preview',
    missing: 'Not entered',
    missingTitle: 'Title not entered',
    missingPrice: 'Price not entered',
    missingImages: (count) => `${count} ${count === 1 ? 'image is' : 'images are'} not ready`,
    noImages: 'No ready images',
    contentLanguage: 'Content language',
    imageAltTexts: 'Image alternative text',
    conversionUnavailable: 'USD conversion unavailable',
    review: { missing: 'Not entered', pending: 'Pending review', approved: 'Approved', stale: 'Outdated text' },
    source: { original: 'Original text', machine: 'Machine translated', human: 'Human translated', catalog: 'Catalog label' },
  },
  ru: {
    draft: 'Предпросмотр черновика',
    missing: 'Не заполнено',
    missingTitle: 'Заголовок не заполнен',
    missingPrice: 'Цена не указана',
    missingImages: (count) => `Изображения не готовы — ${count}`,
    noImages: 'Нет готовых изображений',
    contentLanguage: 'Язык текста',
    imageAltTexts: 'Альтернативный текст изображений',
    conversionUnavailable: 'Пересчёт в USD недоступен',
    review: { missing: 'Не заполнено', pending: 'Ожидает проверки', approved: 'Проверено', stale: 'Устаревший текст' },
    source: { original: 'Исходный текст', machine: 'Машинный перевод', human: 'Перевод человеком', catalog: 'Название из каталога' },
  },
} satisfies Record<Locale, PreviewCopy>;
