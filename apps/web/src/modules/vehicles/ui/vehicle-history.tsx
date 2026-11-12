import type { PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { detailContent } from '../detail-content';
import { publicVehicleMessages } from '../public-messages';
import { ownershipTransfers } from '../vehicle-equipment';
import styles from './public-detail.module.css';

export function VehicleHistory({ vehicle, locale }: {
  vehicle: Pick<PublicVehicle, 'facts' | 'external'>;
  locale: Locale;
}) {
  const copy = detailContent[locale];
  const t = publicVehicleMessages(locale);
  const entries = vehicle.external?.detail?.specifications ?? [];
  const history = [
    { label: t.manufactureLabel, value: vehicle.facts.manufacturedAt?.value },
    { label: t.registrationLabel, value: vehicle.facts.firstRegistration?.value },
    { label: copy.transfers, value: ownershipTransfers(entries) },
  ].filter(({ value }) => value !== undefined);
  if (!history.length) return null;
  return (
    <section className={styles.card} data-vehicle-history>
      <h2 className={styles.cardHeading}>
        <Icon name="clock" size={19} className={styles.historyIcon} />
        {copy.history}
      </h2>
      <dl className={styles.historyPills}>
        {history.map(({ label, value }) => (
          <div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>
        ))}
      </dl>
    </section>
  );
}
