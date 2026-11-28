import { useId, type ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { VehiclePhoto } from '@/modules/vehicles';
import { isPublicVehicleDetailPath } from '@/shared/lib/public-vehicle-detail-path';
import { Icon } from '@/shared/ui/icon';
import type { MarketExtreme } from './market-results';
import styles from './market-extreme-card.module.css';

export function MarketExtremeCard({ locale, vehicle, label, facts, price }: {
  locale: Locale;
  vehicle: MarketExtreme;
  label: string;
  facts: { year: string; trim: string; mileage: string; kilometres: string; history: string };
  price?: ReactNode;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const titleId = `${id}-title`;
  const { href, title, modelYear, trim, mileageKm, image } = vehicle;
  const hasDetail = isPublicVehicleDetailPath(href);
  const content = (
    <>
      <div className={styles.media}>
        <VehiclePhoto image={image} locale={locale} alt={image?.alt || title} compact reportRemoteFailure={false} />
        <div className={styles.mediaTop}>
          <span className={styles.label} id={labelId}>{label}</span>
          {hasDetail && <span className={styles.arrow}><Icon name="diagonal" size={17} /></span>}
        </div>
      </div>
      <div className={styles.body}>
        <h4 className={styles.title} id={titleId}>{title}</h4>
        {(modelYear !== null || trim || mileageKm !== null) && (
          <dl className={styles.facts}>
            {modelYear !== null && <div><dt className="sr-only">{facts.year}</dt><dd>{modelYear}</dd></div>}
            {trim && <div><dt className="sr-only">{facts.trim}</dt><dd>{trim}</dd></div>}
            {mileageKm !== null && <div><dt className="sr-only">{facts.mileage}</dt><dd>
              {new Intl.NumberFormat(locale).format(mileageKm)} {facts.kilometres}
            </dd></div>}
          </dl>
        )}
        {price != null && <div className={styles.price}>{price}</div>}
      </div>
    </>
  );

  return (
    <article className={styles.card}>
      {hasDetail ? <>
        <a className={styles.detail} href={href} aria-labelledby={`${labelId} ${titleId}`}>{content}</a>
        <a className={styles.history} href={`${href}#vehicle-price-history-${vehicle.id}`} aria-describedby={titleId}>
          <Icon name="clock" size={16} />{facts.history}<Icon name="diagonal" size={14} />
        </a>
      </> : <div className={styles.detail}>{content}</div>}
    </article>
  );
}
