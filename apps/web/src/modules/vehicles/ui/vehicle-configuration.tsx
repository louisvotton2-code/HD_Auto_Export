import type { ConfigurationDisplay, DisplayText } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { configurationCopy } from '../configuration-copy';
import { externalDetailCopy } from '../external-detail-copy';
import { publicVehicleMessages } from '../public-messages';
import { EquipmentIcon } from './equipment-icon';
import detailStyles from './public-detail.module.css';
import styles from './vehicle-configuration.module.css';

function ConfigurationText({ field, kind, locale, showMetadata }: {
  field: DisplayText;
  kind: 'name' | 'value';
  locale: Locale;
  showMetadata: boolean;
}) {
  const copy = configurationCopy[locale];
  return (
    <>
      <span
        className={styles.text}
        data-configuration-field={kind}
        data-display-status={field.status}
        data-requested-locale={field.requestedLocale}
        data-provenance={field.provenance ?? undefined}
        data-reviewed={field.reviewed}
        lang={field.contentLocale ?? undefined}
        dir="auto"
      >{field.text ?? publicVehicleMessages(locale).unknown}</span>
      {showMetadata && (
        <small className={styles.metadata} data-configuration-metadata={kind}>
          <span className={styles.review} data-reviewed={field.reviewed}>
            {field.status === 'missing' ? copy.missing : field.reviewed ? copy.reviewed : copy.unreviewed}
          </span>
          {field.provenance && <span>{copy.provenance[field.provenance]}</span>}
          {field.contentLocale && <span>{copy.language} <bdi>{field.contentLocale}</bdi></span>}
        </small>
      )}
    </>
  );
}

/** Both public detail and authenticated preview render the same browser-safe configuration DTO. */
export function VehicleConfiguration({ configuration, locale, showMetadata = false }: {
  configuration: ConfigurationDisplay | null | undefined;
  locale: Locale;
  showMetadata?: boolean;
}) {
  if (!configuration?.items.length) return null;
  return (
    <section className={detailStyles.card} data-vehicle-configuration>
      <details className={detailStyles.information} open>
        <summary>
          <strong className={styles.heading}>
            <span className={detailStyles.equipmentIcon}><Icon name="chip" size={16} /></span>
            <span className={styles.title}>{externalDetailCopy[locale].specifications}</span>
            <b className={detailStyles.equipmentCount}>{configuration.items.length}</b>
          </strong>
          <span aria-hidden="true">⌄</span>
        </summary>
        <dl className={styles.entries}>
          {configuration.items.map(({ id, name, value }) => (
            <div key={id} className={styles.item} data-configuration-item={id}>
              <dt className={styles.itemLabel}>
                <EquipmentIcon label={name.text} fieldId={id} className={styles.itemIcon} />
                <div className={styles.itemLabelText}><ConfigurationText field={name} kind="name" locale={locale} showMetadata={showMetadata} /></div>
              </dt>
              <dd><ConfigurationText field={value} kind="value" locale={locale} showMetadata={showMetadata} /></dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
