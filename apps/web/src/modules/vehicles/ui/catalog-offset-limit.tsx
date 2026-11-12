import type { PublicVehicleQuery } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicCatalogHref } from '../public-presentation';
import catalogStyles from './public-vehicles.module.css';
import styles from './catalog-offset-limit.module.css';

const copy = {
  zh: {
    title: '请缩小筛选范围',
    description: '当前页超出可直接浏览的范围。请缩小筛选条件，或保留当前条件返回第一页。',
    firstPage: '保留筛选条件，返回第一页',
    hint: '结果较多，请缩小筛选条件以浏览更多车辆。',
  },
  en: {
    title: 'Refine your search',
    description: 'This page exceeds the directly browsable range. Narrow your filters, or return to page 1 with your current filters.',
    firstPage: 'Return to page 1 with these filters',
    hint: 'More vehicles match your search. Narrow the filters to browse further.',
  },
  ru: {
    title: 'Уточните условия поиска',
    description: 'Эта страница находится за пределами доступного диапазона. Уточните фильтры или вернитесь на первую страницу с текущими условиями.',
    firstPage: 'На первую страницу с этими фильтрами',
    hint: 'Найдено больше автомобилей. Уточните фильтры, чтобы продолжить просмотр.',
  },
} satisfies Record<Locale, { title: string; description: string; firstPage: string; hint: string }>;

/** The API total remains truthful; this message describes the offset browsing window only. */
export function CatalogOffsetLimitHint({ locale }: { locale: Locale }) {
  return <p className={styles.hint} data-catalog-offset-hint>{copy[locale].hint}</p>;
}

export function CatalogOffsetLimitNotice({ locale, query }: { locale: Locale; query: PublicVehicleQuery }) {
  const text = copy[locale];
  return (
    <main id="main" className={catalogStyles.page} data-testid="catalog-offset-limit">
      <div className={catalogStyles.shell}>
        <section className={styles.notice} aria-labelledby="catalog-offset-title">
          <h1 id="catalog-offset-title">{text.title}</h1>
          <p>{text.description}</p>
          <a href={publicCatalogHref(locale, query, 1)}>{text.firstPage}</a>
        </section>
      </div>
    </main>
  );
}
