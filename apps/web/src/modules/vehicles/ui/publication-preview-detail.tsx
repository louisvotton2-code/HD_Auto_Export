'use client';

import type { PublicationPreview, PublicationPreviewText } from '@hd/contracts/admin';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { catalogFilterCopy } from '../catalog-filter-copy';
import { detailContent } from '../detail-content';
import { publicationPreviewCopy } from '../publication-preview-copy';
import { publicationPreviewImages, publicationPreviewPrice } from '../publication-preview-presentation';
import { publicVehicleMessages } from '../public-messages';
import { publicVehicleFacts } from '../public-presentation';
import { VehicleGallery } from './vehicle-gallery';
import type { VehicleGalleryImageStatus } from './vehicle-gallery-image';
import { VehicleHistory } from './vehicle-history';
import { VehiclePriceAmounts } from './vehicle-price-values';
import detailStyles from './public-detail.module.css';
import styles from './publication-preview-detail.module.css';

function PreviewTextState({ field, locale }: { field: PublicationPreviewText; locale: Locale }) {
  const copy = publicationPreviewCopy[locale];
  return (
    <span className={styles.textState}>
      <span className={styles.review} data-review-status={field.reviewStatus}>{copy.review[field.reviewStatus]}</span>
      {field.kind && <span data-preview-source-kind={field.kind}>{copy.source[field.kind]}</span>}
      {field.contentLocale && <span>{copy.contentLanguage} <bdi>{field.contentLocale}</bdi></span>}
    </span>
  );
}

/** Render only the authenticated projection supplied by the preview resource boundary. */
export function PublicationPreviewDetail({ preview, onActiveImageStatus }: {
  preview: PublicationPreview;
  onActiveImageStatus?: (status: VehicleGalleryImageStatus) => void;
}) {
  const { vehicle, locale } = preview;
  const copy = publicationPreviewCopy[locale];
  const detail = detailContent[locale];
  const t = publicVehicleMessages(locale);
  const filterLabels = catalogFilterCopy[locale];
  const title = vehicle.content.title;
  const description = vehicle.content.description;
  const images = publicationPreviewImages(vehicle.images);
  const missingImageCount = vehicle.images.length - images.length;
  const price = publicationPreviewPrice(vehicle.price, locale);
  const mileage = vehicle.facts.mileageKm?.toLocaleString(locale);
  const locationText = vehicle.facts.location?.displayName
    ? vehicle.display.location
    : vehicle.facts.location?.city ? vehicle.display.city : undefined;
  const factText = new Map<string, PublicationPreviewText>([
    [filterLabels.trim, vehicle.display.trim],
    [filterLabels.generation, vehicle.display.generation],
  ]);
  if (locationText) factText.set(t.locationLabel, locationText);
  const facts = [
    { label: t.make, value: vehicle.display.make.text ?? copy.missing, field: vehicle.display.make },
    { label: t.model, value: vehicle.display.model.text ?? copy.missing, field: vehicle.display.model },
    ...publicVehicleFacts(vehicle, locale).map((fact) => ({ ...fact, field: factText.get(fact.label) })),
    { label: t.availabilityLabel, value: t.availability[vehicle.availability] || t.unknown, field: undefined },
  ];
  const galleryKey = `${vehicle.id}:${preview.vehicleVersion}:${preview.publicContentRevision}:${preview.fingerprint}:${locale}`;

  return (
    <main
      id="main"
      className={`${detailStyles.page} ${styles.preview}`}
      lang={locale === 'zh' ? 'zh-Hans' : locale}
      data-testid="publication-preview-body"
      data-preview-locale={locale}
      data-vehicle-version={preview.vehicleVersion}
      data-public-content-revision={preview.publicContentRevision}
      data-fingerprint={preview.fingerprint}
    >
      <div className={detailStyles.container}>
        <div className={styles.layout}>
          <div className={styles.content}>
            <header data-preview-text="title">
              <p className={styles.draft}>{copy.draft}</p>
              <h1 className={detailStyles.title} lang={title.contentLocale ?? undefined} dir="auto">
                {title.text ?? copy.missingTitle}
              </h1>
              <PreviewTextState field={title} locale={locale} />
              <p className={detailStyles.subtitle}>
                {mileage === undefined ? t.unknown : `${mileage} ${t.km}`} ·{' '}
                {vehicle.facts.transmission ? t.transmissions[vehicle.facts.transmission] : t.unknown}
              </p>
            </header>

            <VehicleGallery key={galleryKey} images={images} title={title.text ?? copy.missingTitle} locale={locale}
              onActiveImageStatus={onActiveImageStatus} />
            {!images.length && <p className={styles.imageNote} data-preview-image-state="empty">{copy.noImages}</p>}
            {missingImageCount > 0 && <p className={styles.imageNote} data-preview-image-state="missing">{copy.missingImages(missingImageCount)}</p>}

            <div className={detailStyles.tiles}>
              <div className={detailStyles.tile}>
                <p><span className={detailStyles.tileIcon}><Icon name="document" size={16} /></span>{detail.inquiry}</p>
                <bdi>{vehicle.stockCode}</bdi>
              </div>
              <div className={`${detailStyles.tile} ${detailStyles.mileageTile}`}>
                <p><span className={detailStyles.tileIcon}><Icon name="gauge" size={16} /></span>{detail.mileage}</p>
                <strong>{mileage ?? t.unknown}{mileage !== undefined && <small>{t.km}</small>}</strong>
              </div>
            </div>

            <section className={detailStyles.card}>
              <details className={detailStyles.information} open>
                <summary>{detail.basicInformation}<span aria-hidden="true">⌄</span></summary>
                <dl className={`${detailStyles.specifications} ${styles.facts}`}>
                  {facts.map(({ label, value, field }) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        <span lang={field?.contentLocale ?? undefined} dir="auto">{field ? field.text ?? copy.missing : value}</span>
                        {field && <PreviewTextState field={field} locale={locale} />}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            </section>

            <VehicleHistory vehicle={vehicle} locale={locale} />

            <section className={detailStyles.card} data-preview-text="description">
              <h2 className={detailStyles.cardHeading}><span aria-hidden="true" />{detail.publicDescription}</h2>
              <div className={styles.description}>
                <PreviewTextState field={description} locale={locale} />
                <p lang={description.contentLocale ?? undefined} dir="auto">{description.text ?? copy.missing}</p>
              </div>
            </section>

            {vehicle.display.mediaAlt.length > 0 && (
              <section className={detailStyles.card}>
                <details className={detailStyles.information}>
                  <summary>{copy.imageAltTexts}<span aria-hidden="true">⌄</span></summary>
                  <dl className={`${detailStyles.specifications} ${styles.facts}`}>
                    {vehicle.display.mediaAlt.map(({ mediaId, value }) => (
                      <div key={mediaId}>
                        <dt><bdi>{mediaId}</bdi></dt>
                        <dd>
                          <span lang={value.contentLocale ?? undefined} dir="auto">{value.text ?? copy.missing}</span>
                          <PreviewTextState field={value} locale={locale} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </section>
            )}
          </div>

          <aside className={`${detailStyles.priceCard} ${styles.price}`} aria-label={t.priceLabels[vehicle.price.kind]}>
            {vehicle.price.kind !== 'on_request' && <h2>{t.priceLabels[vehicle.price.kind]}</h2>}
            <div className={styles.amounts} data-preview-price-status={vehicle.price.status}>
              <VehiclePriceAmounts original={price.original} approximation={price.approximation} />
            </div>
            {vehicle.price.displayPrice?.status === 'unavailable' && <p className={styles.priceNote}>{copy.conversionUnavailable}</p>}
            <p className={styles.priceNote}>{t.priceNote}</p>
            {(vehicle.display.priceIncludes.length > 0 || vehicle.price.includes.length > 0) && (
              <section className={styles.includes}>
                <h3>{detail.includes}</h3>
                <ul>
                  {vehicle.display.priceIncludes.length > 0
                    ? vehicle.display.priceIncludes.map(({ id, value }) => (
                        <li key={id}>
                          <span lang={value.contentLocale ?? undefined} dir="auto">{value.text ?? copy.missing}</span>
                          <PreviewTextState field={value} locale={locale} />
                        </li>
                      ))
                    : vehicle.price.includes.map((value, index) => <li key={index}>{value}</li>)}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
