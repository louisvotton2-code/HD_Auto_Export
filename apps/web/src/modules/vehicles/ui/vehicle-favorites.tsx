'use client';

import { useEffect, useRef, useState } from 'react';
import { VehiclePhoto } from './vehicle-photo';
import type { Locale } from '@/i18n/routing';
import type { PublicVehicle } from '@hd/contracts/public';
import { NavigationLink } from '@/shared/ui/navigation-link';
import { publicUsdQuote } from '@/shared/lib/public-vehicle-price';
import {
  readFavoriteVehicle,
  type FavoriteVehicleResult,
} from '../application/read-favorite-vehicle';
import { useVehicleFavorites } from '../application/use-vehicle-favorites';
import { favoritesContent } from '../favorites-content';
import { publicVehicleMessages } from '../public-messages';
import {
  formatPublicVehiclePrice,
  publicVehicleCover,
  publicAvailabilityLabel,
} from '../public-presentation';
import { PublicCatalogLink } from './public-catalog-link';
import { VehicleRateAttribution } from './vehicle-rate-attribution';
import styles from './vehicle-favorites.module.css';

type Row = FavoriteVehicleResult | { kind: 'loading' };
function Heart() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}

function SavedCar({
  vehicle,
  locale,
  close,
}: {
  vehicle: PublicVehicle;
  locale: Locale;
  close: () => void;
}) {
  const cover = publicVehicleCover(vehicle);
  const copy = publicVehicleMessages(locale);
  const quote = publicUsdQuote(vehicle);
  const status =
    vehicle.availability === 'sold' || vehicle.availability === 'reserved'
      ? publicAvailabilityLabel(vehicle, locale)
      : '';
  return (
    <>
      <PublicCatalogLink
        locale={locale}
        href={vehicle.detailPath}
        className={styles.photo}
        tabIndex={-1}
        aria-hidden="true"
        onClick={close}
      >
        <VehiclePhoto image={cover} locale={locale} alt="" compact />
      </PublicCatalogLink>
      <div className={styles.info}>
        <PublicCatalogLink locale={locale} href={vehicle.detailPath} onClick={close} lang={vehicle.content.title.contentLocale}>
          {vehicle.content.title.text}
        </PublicCatalogLink>
        <small>
          {vehicle.stockCode}
          {vehicle.facts.modelYear !== null ? ` · ${vehicle.facts.modelYear}` : ''}
        </small>
        {status && (
          <span className={styles.availability} data-availability={vehicle.availability}>
            {status}
          </span>
        )}
        {quote && <span className={styles.priceKind}>{copy.priceLabels[quote.kind]}</span>}
        <strong>{formatPublicVehiclePrice(vehicle, locale)}</strong>
      </div>
    </>
  );
}

/** Browser IDs persist; current titles/prices are resolved only when the visitor opens this drawer. */
export function VehicleFavorites({ locale }: { locale: Locale }) {
  const { ids, remove } = useVehicleFavorites();
  const t = favoritesContent[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [attempt, setAttempt] = useState(0);
  const deadline = useRef(0);
  const [retryAfter, setRetryAfter] = useState(0);
  const idsKey = JSON.stringify(ids);

  function close() {
    dialog.current?.close();
  }
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const currentIds: string[] = JSON.parse(idsKey);
    setRows(Object.fromEntries(currentIds.map((id) => [id, { kind: 'loading' }])));
    const remaining = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
    if (remaining > 0) {
      setRows(
        Object.fromEntries(currentIds.map((id) => [id, { kind: 'limited', seconds: remaining }])),
      );
      setRetryAfter(remaining);
      return;
    }
    async function load() {
      for (let i = 0; i < currentIds.length; i++) {
        const id = currentIds[i];
        const result = await readFavoriteVehicle(id, locale, controller.signal);
        if (controller.signal.aborted) return;
        setRows((current) => ({ ...current, [id]: result }));
        if (result.kind === 'limited') {
          deadline.current = Date.now() + result.seconds * 1000;
          setRetryAfter(result.seconds);
          setRows((current) => ({
            ...current,
            ...Object.fromEntries(currentIds.slice(i + 1).map((key) => [key, result])),
          }));
          break;
        }
      }
    }
    void load().catch(() => {
      /* Closing or removing a saved entry cancels this read. */
    });
    return () => controller.abort();
  }, [open, idsKey, locale, attempt]);
  useEffect(() => {
    if (!retryAfter) return;
    const timer = window.setInterval(
      () => setRetryAfter(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))),
      250,
    );
    return () => clearInterval(timer);
  }, [retryAfter > 0]);

  const failed = ids.some((id) => rows[id]?.kind === 'error' || rows[id]?.kind === 'limited');
  const displayedVehicles = ids.flatMap((id) => {
    const row = rows[id];
    return row?.kind === 'vehicle' ? [row.vehicle] : [];
  });
  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        ref={trigger}
        aria-label={`${t.open}${ids.length ? ` (${ids.length})` : ''}`}
        aria-haspopup="dialog"
        aria-controls="vehicle-favorites"
        aria-expanded={open}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <Heart />
        {ids.length > 0 && (
          <span className={styles.count} aria-hidden="true">
            {ids.length}
          </span>
        )}
      </button>
      <dialog
        id="vehicle-favorites"
        ref={dialog}
        className={styles.drawer}
        aria-labelledby="vehicle-favorites-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            )
              close();
          }
        }}
        onClose={() => {
          setOpen(false);
          setRows({});
          trigger.current?.focus();
        }}
      >
        <div className={styles.head}>
          <div>
            <h2 id="vehicle-favorites-title">{t.title}</h2>
            <p>{t.savedOnBrowser}</p>
          </div>
          <button type="button" className={styles.close} aria-label={t.close} onClick={close}>
            ×
          </button>
        </div>
        <div
          className={styles.body}
          aria-busy={open && ids.some((id) => !rows[id] || rows[id].kind === 'loading')}
        >
          {ids.length === 0 ? (
            <div className={styles.empty}>
              <Heart />
              <h3>{t.empty}</h3>
              <p>{t.hint}</p>
            </div>
          ) : (
            <ul className={styles.list}>
              {ids.map((id) => {
                const row = rows[id];
                return (
                  <li key={id} data-favorite-vehicle={id}>
                    {row?.kind === 'vehicle' ? (
                      <SavedCar vehicle={row.vehicle} locale={locale} close={close} />
                    ) : (
                      <div className={styles.info}>
                        <p>
                          {!row || row.kind === 'loading'
                            ? t.loading
                            : row.kind === 'missing'
                              ? t.missing
                              : t.error}
                        </p>
                        <small>{id}</small>
                      </div>
                    )}
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={`${t.remove} — ${row?.kind === 'vehicle' ? row.vehicle.content.title.text : id}`}
                      onClick={() => remove(id)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <VehicleRateAttribution vehicles={displayedVehicles} locale={locale} />
          {failed && (
            <div className={styles.status} role="status">
              <button
                type="button"
                disabled={retryAfter > 0}
                onClick={() => {
                  if (deadline.current <= Date.now()) setAttempt((value) => value + 1);
                }}
              >
                {retryAfter > 0 ? t.retryIn(retryAfter) : t.retry}
              </button>
            </div>
          )}
        </div>
        <div className={styles.foot}>
          <NavigationLink href="/cars/" onClick={close}>
            {t.browse} <span aria-hidden="true">→</span>
          </NavigationLink>
        </div>
      </dialog>
    </>
  );
}
