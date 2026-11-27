import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { marketCopy } from './market-copy';
import styles from './market-screen.module.css';

export function MarketPricesFrame({ locale, children }: { locale: Locale; children: ReactNode }) {
  const copy = marketCopy[locale];
  return (
    <main id="main" className={styles.screen} data-testid="market-prices-page">
      <div className={styles.intro}>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
      </div>
      {children}
    </main>
  );
}
