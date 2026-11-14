import type { ExternalPublicDetail } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { groupVehicleEquipment } from '../vehicle-equipment';
import { EquipmentIcon } from './equipment-icon';
import styles from './public-detail.module.css';

const icons = { comfort: 'seat', safety: 'shield', technology: 'chip', other: 'info' } as const;

export function VehicleEquipment({
  specifications,
  title,
  locale,
}: {
  specifications: ExternalPublicDetail['specifications'];
  title: string;
  locale: Locale;
}) {
  const groups = groupVehicleEquipment(specifications, locale);
  if (!groups.length) return null;
  const count = groups.reduce((sum, group) => sum + group.entries.length, 0);

  return (
    <section className={styles.card} data-vehicle-equipment>
      <details className={styles.information} open>
        <summary>
          <strong className={styles.equipmentTitle}>{title}<span className={styles.equipmentCount}>{count}</span></strong>
          <span aria-hidden="true">⌄</span>
        </summary>
        {groups.map(({ group, label, entries }) => (
          <details className={styles.equipmentGroup} key={group} data-equipment-group={group}>
            <summary>
              <span className={styles.equipmentIcon}><Icon name={icons[group]} size={16} /></span>
              <span>{label}</span>
              <b className={styles.equipmentCount}>{entries.length}</b>
              <Icon name="chevron" size={15} className={styles.equipmentChevron} />
            </summary>
            <dl className={styles.equipmentGrid}>
              {entries.map(({ name, value }, index) => (
                <div key={index}>
                  <dt lang={name.contentLocale} dir="auto">
                    <span className={styles.equipmentIcon}><EquipmentIcon label={name.text} size={16} /></span>
                    {name.text}
                  </dt>
                  <dd lang={value.contentLocale} dir="auto">{value.text}</dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
      </details>
    </section>
  );
}
