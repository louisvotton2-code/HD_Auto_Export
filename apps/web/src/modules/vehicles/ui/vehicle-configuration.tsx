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

export function ConfigurationDisplayMetadata({ field, kind, locale }: {
  field: DisplayText;
  kind: 'name' | 'value';
  locale: Locale;
}) {
  const copy = configurationCopy[locale];
  return (
    <small className={styles.metadata} data-configuration-metadata={kind}>
      <span className={styles.review} data-reviewed={field.reviewed}>
        {field.status === 'missing' ? copy.missing : field.reviewed ? copy.reviewed : copy.unreviewed}
      </span>
      {field.provenance && <span>{copy.provenance[field.provenance]}</span>}
      {field.contentLocale && <span>{copy.language} <bdi>{field.contentLocale}</bdi></span>}
    </small>
  );
}

function ConfigurationText({ field, kind, locale, showMetadata }: {
  field: ConfigurationField;
  kind: 'name' | 'value';
  locale: Locale;
  showMetadata: boolean;
}) {
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
      {showMetadata && display && <ConfigurationDisplayMetadata field={display} kind={kind} locale={locale} />}
    </>
  );
}

/** Both public detail and authenticated preview render the same browser-safe configuration DTO. */
export function VehicleConfiguration({ configuration, locale, showMetadata = false, defaultOpen = false }: {
  configuration: (Omit<ConfigurationDisplay, 'items'> & {
    items: readonly (ConfigurationDisplay['items'][number] & { semanticKey?: string | null })[];
  }) | null | undefined;
  locale: Locale;
  showMetadata?: boolean;
  defaultOpen?: boolean;
}) {
  return <VehicleConfigurationGrid items={configuration?.items ?? []} locale={locale} showMetadata={showMetadata} defaultOpen={defaultOpen} />;
}

/** One bounded, flat grid for inline public data and legacy public/staff projections. */
export function VehicleConfigurationGrid({
  items, locale, showMetadata = false, source = 'configuration', defaultOpen = false,
}: {
  items: readonly VehicleConfigurationItem[];
  locale: Locale;
  showMetadata?: boolean;
  source?: 'configuration' | 'equipment';
  defaultOpen?: boolean;
}) {
  if (!items.length) return null;
  return (
    <section
      className={detailStyles.card}
      data-vehicle-parameters
      data-vehicle-configuration={source === 'configuration' || undefined}
      data-vehicle-equipment={source === 'equipment' || undefined}
    >
      <details className={detailStyles.information} open={defaultOpen}>
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
