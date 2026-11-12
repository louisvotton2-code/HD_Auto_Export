import type { PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { detailContent } from '../detail-content';
import { vehicleHistory } from '../vehicle-history-data';
import styles from './public-detail.module.css';

export function VehicleHistory({ vehicle, locale }: {
  vehicle: Pick<PublicVehicle, 'facts' | 'external'>;
  locale: Locale;
}) {
  const copy = detailContent[locale];
  const history = vehicleHistory(vehicle, locale);
  if (!history.length) return null;
  return (
    <section className={styles.card} data-vehicle-history>
      <h2 className={styles.cardHeading}>
        <Icon name="clock" size={19} className={styles.historyIcon} />
        {copy.history}
      </h2>
      <dl className={styles.historyPills}>
        {history.map(({ kind, label, value, lang }) => (
          <div key={kind} data-history-kind={kind}><dt>{label}</dt><dd lang={lang} dir="auto"><bdi>{value}</bdi></dd></div>
        ))}
      </dl>
    </section>
  );
}
