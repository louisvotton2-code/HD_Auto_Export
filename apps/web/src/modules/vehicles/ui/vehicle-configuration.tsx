import type { ConfigurationDisplay, DisplayText } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { configurationCopy } from '../configuration-copy';
import { publicVehicleMessages } from '../public-messages';
import { EquipmentIcon } from './equipment-icon';
import detailStyles from './public-detail.module.css';
import styles from './vehicle-configuration.module.css';

type ConfigurationField = DisplayText | { text: string; contentLocale: string };

export type VehicleConfigurationItem = {
  id: string;
  semanticKey?: string | null;
  fieldId?: string;
  name: ConfigurationField;
  value: ConfigurationField;
};

const titles: Record<Locale, string> = {
  zh: '车辆参数与配置', en: 'Vehicle parameters and equipment', ru: 'Характеристики и комплектация',
};

function ConfigurationText({ field, kind, locale, showMetadata }: {
  field: ConfigurationField;
  kind: 'name' | 'value';
  locale: Locale;
  showMetadata: boolean;
}) {
  const copy = configurationCopy[locale];
  const display = 'status' in field ? field : undefined;
  return (
    <>
      <span
        className={styles.text}
        data-configuration-field={kind}
        data-display-status={display?.status}
        data-requested-locale={display?.requestedLocale}
        data-provenance={display?.provenance ?? undefined}
        data-reviewed={display?.reviewed}
        lang={field.contentLocale ?? undefined}
        dir="auto"
      >{field.text ?? publicVehicleMessages(locale).unknown}</span>
      {showMetadata && display && (
        <small className={styles.metadata} data-configuration-metadata={kind}>
          <span className={styles.review} data-reviewed={display.reviewed}>
            {display.status === 'missing' ? copy.missing : display.reviewed ? copy.reviewed : copy.unreviewed}
          </span>
          {display.provenance && <span>{copy.provenance[display.provenance]}</span>}
          {field.contentLocale && <span>{copy.language} <bdi>{field.contentLocale}</bdi></span>}
        </small>
      )}
    </>
  );
}

/** Both public detail and authenticated preview render the same browser-safe configuration DTO. */
export function VehicleConfiguration({ configuration, locale, showMetadata = false }: {
  configuration: (Omit<ConfigurationDisplay, 'items'> & {
    items: readonly (ConfigurationDisplay['items'][number] & { semanticKey?: string | null })[];
  }) | null | undefined;
  locale: Locale;
  showMetadata?: boolean;
}) {
  return <VehicleConfigurationGrid items={configuration?.items ?? []} locale={locale} showMetadata={showMetadata} />;
}

/** One bounded, flat grid for inline public data and legacy public/staff projections. */
export function VehicleConfigurationGrid({ items, locale, showMetadata = false, source = 'configuration' }: {
  items: readonly VehicleConfigurationItem[];
  locale: Locale;
  showMetadata?: boolean;
  source?: 'configuration' | 'equipment';
}) {
  if (!items.length) return null;
  return (
    <section
      className={detailStyles.card}
      data-vehicle-parameters
      data-vehicle-configuration={source === 'configuration' || undefined}
      data-vehicle-equipment={source === 'equipment' || undefined}
    >
      <details className={detailStyles.information} open>
        <summary>
          <strong className={styles.heading}>
            <span className={detailStyles.equipmentIcon}><Icon name="chip" size={16} /></span>
            <span className={styles.title}>{titles[locale]}</span>
            <b className={detailStyles.equipmentCount}>{items.length}</b>
          </strong>
          <span aria-hidden="true"><Icon name="chevron" size={18} /></span>
        </summary>
        <dl className={styles.entries}>
          {items.map(({ id, name, value, semanticKey, fieldId }) => (
            <div key={id} className={styles.item} data-configuration-item={id}>
              <dt className={styles.itemLabel}>
                <EquipmentIcon label={name.text} fieldId={fieldId ?? id} semanticKey={semanticKey} className={styles.itemIcon} />
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
