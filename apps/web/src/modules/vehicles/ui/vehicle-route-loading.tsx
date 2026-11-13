import type { Locale } from '@/i18n/routing';
import { publicVehicleMessages } from '../public-messages';
import styles from './vehicle-route-loading.module.css';

/** Used only below route validity checks, so the fallback cannot turn a real 404 into a streamed 200. */
export function VehicleRouteLoading({ locale, kind }: { locale: Locale; kind: 'catalog' | 'detail' }) {
  const t = publicVehicleMessages(locale);
  return (
    <main id="main" className={styles.page} aria-busy="true" data-vehicle-route-loading={kind}>
      <p className={styles.srOnly} role="status">{t.loading}</p>
      <div className={styles.shell} aria-hidden="true">
        {kind === 'catalog' ? (
          <div className={styles.catalog}>
            <div className={styles.filters}>
              {Array.from({ length: 7 }, (_, index) => <div key={index} className={styles.field} />)}
            </div>
            <div className={styles.cards}>
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className={styles.card}>
                  <div className={styles.photo} />
                  <div className={styles.cardBody}><div className={styles.line} /><div className={styles.shortLine} /></div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.detail}>
            <div className={styles.detailMain}>
              <div className={styles.heading} /><div className={styles.shortLine} />
              <div className={styles.hero} />
              <div className={styles.thumbnails}>{Array.from({ length: 5 }, (_, index) => <div key={index} className={styles.thumbnail} />)}</div>
              <div className={styles.panel}><div className={styles.line} /><div className={styles.line} /><div className={styles.shortLine} /></div>
            </div>
            <div className={styles.panel}><div className={styles.heading} /><div className={styles.field} /><div className={styles.field} /><div className={styles.field} /></div>
          </div>
        )}
      </div>
    </main>
  );
}
