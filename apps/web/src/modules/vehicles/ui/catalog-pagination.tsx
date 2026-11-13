import type { MouseEvent } from 'react';
import type { PublicVehicleCardList, PublicVehicleQuery } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { catalogPagination } from '../catalog-pagination';
import { publicCatalogHref } from '../public-presentation';
import { publicVehicleMessages } from '../public-messages';
import { CatalogOffsetLimitHint } from './catalog-offset-limit';
import styles from './public-vehicles.module.css';

const copy = {
  zh: {
    page: (value: number) => `第 ${value.toLocaleString('zh')} 页`,
    pages: (current: number, total: number) => `第 ${current.toLocaleString('zh')} 页，共 ${total.toLocaleString('zh')} 页`,
    accessible: '可浏览页数',
    outOfRange: (current: number, total: number) => `第 ${current.toLocaleString('zh')} 页暂无结果，共 ${total.toLocaleString('zh')} 页`,
  },
  en: {
    page: (value: number) => `Page ${value.toLocaleString('en')}`,
    pages: (current: number, total: number) => `Page ${current.toLocaleString('en')} of ${total.toLocaleString('en')}`,
    accessible: 'Available pages',
    outOfRange: (current: number, total: number) => `Page ${current.toLocaleString('en')} is outside the ${total.toLocaleString('en')} available pages`,
  },
  ru: {
    page: (value: number) => `Страница ${value.toLocaleString('ru')}`,
    pages: (current: number, total: number) => `Страница ${current.toLocaleString('ru')} из ${total.toLocaleString('ru')}`,
    accessible: 'Доступные страницы',
    outOfRange: (current: number, total: number) => `Страница ${current.toLocaleString('ru')} вне диапазона доступных страниц: ${total.toLocaleString('ru')}`,
  },
} satisfies Record<Locale, {
  page: (value: number) => string;
  pages: (current: number, total: number) => string;
  accessible: string;
  outOfRange: (current: number, total: number) => string;
}>;

export function CatalogPagination({ result, query, locale, onPageClick }: {
  result: {
    data: Pick<PublicVehicleCardList['data'], 'page' | 'pageSize' | 'hasMore'>;
    meta: PublicVehicleCardList['meta'];
  };
  query: PublicVehicleQuery;
  locale: Locale;
  onPageClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const t = publicVehicleMessages(locale);
  const labels = copy[locale];
  const { page } = result.data;
  const pager = catalogPagination({ ...result.meta, ...result.data });
  if (pager.totalPages === 0 && page === 1) return null;
  const pageInfoLabel = pager.outOfRange ? labels.outOfRange(page, pager.totalPages!)
    : pager.totalPages === null ? labels.page(page)
      : `${pager.totalKind === 'accessible' ? `${labels.accessible} ` : ''}${labels.pages(page, pager.totalPages)}`;

  return (
    <nav className={styles.pagination} aria-label={t.pagination} data-catalog-pagination>
      {pager.previous !== null ? (
        <a className={styles.pageButton} href={publicCatalogHref(locale, query, pager.previous)} rel="prev" aria-label={t.previous} onClick={onPageClick}>
          <span aria-hidden="true">←</span>
        </a>
      ) : <span className={styles.pageButton} aria-disabled="true" aria-label={t.previous}><span aria-hidden="true">←</span></span>}
      {pager.items.map((item) => item === 'ellipsis' ? (
        <span key="ellipsis" className={styles.pageDots} aria-hidden="true">…</span>
      ) : item === page ? (
        <span key={item} className={styles.pageButton} data-compact-number={item >= 100_000 || undefined} aria-current="page" aria-label={labels.page(item)}>{item.toLocaleString(locale, { useGrouping: false })}</span>
      ) : (
        <a key={item} className={styles.pageButton} data-compact-number={item >= 100_000 || undefined} href={publicCatalogHref(locale, query, item)} aria-label={labels.page(item)} onClick={onPageClick}>{item.toLocaleString(locale, { useGrouping: false })}</a>
      ))}
      {pager.next !== null ? (
        <a className={styles.pageButton} href={publicCatalogHref(locale, query, pager.next)} rel="next" aria-label={t.next} onClick={onPageClick}>
          <span aria-hidden="true">→</span>
        </a>
      ) : <span className={styles.pageButton} aria-disabled="true" aria-label={t.next}><span aria-hidden="true">→</span></span>}
      <span className={styles.pageInfo} aria-label={pageInfoLabel} data-catalog-page-count={pager.totalPages ?? 'unknown'}>
        {pager.outOfRange ? labels.outOfRange(page, pager.totalPages!) : (
          <>{pager.totalKind === 'accessible' && `${labels.accessible} `}{page.toLocaleString(locale)}{pager.totalPages !== null && <> / {pager.totalPages.toLocaleString(locale)}</>}</>
        )}
      </span>
      {pager.truncated && <CatalogOffsetLimitHint locale={locale} />}
    </nav>
  );
}
