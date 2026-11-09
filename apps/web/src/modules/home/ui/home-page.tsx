'use client';

import NextLink from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/routing';
import type { PublicHomeSection, PublicVehicleFilters } from '@hd/contracts/public';
import {
  formatPublicVehiclePrice,
  publicAvailabilityLabel,
  publicVehicleCover,
  publicVehicleMessages,
  usePublicFreshness,
  FavoriteVehicleButton,
  VehiclePhoto,
} from '@/modules/vehicles';
import { NavigationLink as Link } from '@/shared/ui/navigation-link';
import { siteConfig } from '@/shared/config/site';
import { Icon } from '@/shared/ui/icon';
import { SocialIcon } from '@/shared/ui/social-icon';
import { buildPublicVehicleContactLinks } from '@/shared/lib/vehicle-contact';
import { HeroCanvas } from './hero-canvas';
import { HomeSections } from './home-sections';
import { HeroStats } from './hero-stats';
import { usePointerTilt } from '@/shared/ui/use-pointer-tilt';
import styles from './home.module.css';
import type { HomeModel } from '../types';
import { homeContent } from '../content/home-content';

function VehicleRail({
  section,
  locale,
  paused,
}: {
  section: PublicHomeSection;
  locale: Locale;
  paused: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [interacting, setInteracting] = useState(false);
  const pointerTilt = usePointerTilt(section.vehicles);
  const t = homeContent[locale];
  const vehicleCopy = publicVehicleMessages(locale);
  const { id, title, vehicles } = section;
  const trusted = usePublicFreshness() === 'fresh';
  const advance = (direction: number) => {
    const node = rail.current;
    if (!node) return;
    const width = node.firstElementChild?.getBoundingClientRect().width ?? node.clientWidth;
    const max = node.scrollWidth - node.clientWidth,
      target = node.scrollLeft + direction * (width + 20);
    node.scrollTo({
      left: target > max + 5 ? 0 : target < -5 ? max : target,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };
  useEffect(() => {
    const node = rail.current;
    if (!node || paused || interacting || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    let visible = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0.3 },
    );
    observer.observe(node);
    const timer = window.setInterval(() => {
      if (visible && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches)
        advance(1);
    }, 3000);
    return () => {
      observer.disconnect();
      clearInterval(timer);
    };
  }, [paused, interacting, vehicles.length]);
  return (
    <section className={styles.brandSection} data-home-section={`vehicles-${id}`}>
      <div className={styles.sectionHead}>
        <h2>{title}</h2>
        {vehicles.length > 1 && (
          <div className={styles.railControls}>
            <button
              type="button"
              onClick={() => advance(-1)}
              aria-label={`${title} — ${t.previous}`}
            >
              ‹
            </button>
            <button type="button" onClick={() => advance(1)} aria-label={`${title} — ${t.next}`}>
              ›
            </button>
          </div>
        )}
      </div>
      <div
        className={styles.vehicleRail}
        ref={rail}
        tabIndex={0}
        aria-label={`${title} — ${t.catalog}`}
        onMouseEnter={() => setInteracting(true)}
        onMouseLeave={() => setInteracting(false)}
        onFocusCapture={() => setInteracting(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setInteracting(false);
        }}
        onTouchStart={() => setInteracting(true)}
        onTouchEnd={() => setInteracting(false)}
        onTouchCancel={() => setInteracting(false)}
      >
        {vehicles.map((v) => {
          const links = buildPublicVehicleContactLinks(v, locale);
          const image = publicVehicleCover(v);
          const name = v.content.title.text;
          return (
            <div className={styles.vehicleSlot} key={v.id}>
              <article
                className={styles.vehicleCard}
                data-public-vehicle={v.id}
                data-pointer-tilt
                {...pointerTilt}
              >
                <div className={styles.cardLight} aria-hidden="true" />
                <div className={styles.vehicleImage}>
                  <NextLink href={v.detailPath} prefetch={false} tabIndex={-1} aria-hidden="true">
                    <VehiclePhoto image={image} locale={locale} alt={image?.alt || name} />
                  </NextLink>
                  <FavoriteVehicleButton
                    className={styles.save}
                    vehicleId={v.id}
                    title={name}
                    locale={locale}
                  />
                  {v.facts.modelYear !== null && (
                    <span className={styles.year}>
                      {vehicleCopy.yearLabel} {v.facts.modelYear}
                    </span>
                  )}
                </div>
                <div className={styles.vehicleBody}>
                  <h3 lang={v.content.title.contentLocale} title={name}>{name}</h3>
                  <p className={styles.make}>{v.facts.make?.name ?? vehicleCopy.unknown}</p>
                  <p className={styles.stockCode}>
                    {vehicleCopy.stockCodeLabel}: {v.stockCode}
                  </p>
                  {trusted && v.availability !== 'unknown' && (
                    <p className={styles.availability} data-availability={v.availability}>
                      {publicAvailabilityLabel(v, locale)}
                    </p>
                  )}
                  <div className={styles.specs}>
                    <span>
                      {vehicleCopy.mileageLabel}:{' '}
                      {v.facts.mileageKm === null
                        ? vehicleCopy.unknown
                        : `${v.facts.mileageKm.toLocaleString(locale)} ${vehicleCopy.km}`}
                    </span>
                    <span>{vehicleCopy.powertrains[v.facts.powertrain]}</span>
                  </div>
                  <div className={styles.price}>
                    {v.price.kind !== 'on_request' && (
                      <span>{vehicleCopy.priceLabels[v.price.kind]}</span>
                    )}
                    <strong>{formatPublicVehiclePrice(v, locale)}</strong>
                  </div>
                  <div className={styles.cardContact} data-vehicle-contacts={v.id}>
                    <a
                      href={trusted ? links.telegram : undefined}
                      aria-disabled={!trusted || undefined}
                      tabIndex={trusted ? undefined : -1}
                      aria-label={`${vehicleCopy.contactTelegram} — ${name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <SocialIcon platform="telegram" size={20} />
                    </a>
                    <a
                      href={trusted ? links.whatsapp : undefined}
                      aria-disabled={!trusted || undefined}
                      tabIndex={trusted ? undefined : -1}
                      aria-label={`${vehicleCopy.contactWhatsapp} — ${name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <SocialIcon platform="whatsapp" size={20} />
                    </a>
                    <NextLink className={styles.details} href={v.detailPath} prefetch={false}>
                      {t.details}
                      <Icon name="arrow" size={14} />
                    </NextLink>
                  </div>
                </div>
              </article>
            </div>
          );
        })}
      </div>
    </section>
  );
}
export function HomePage({
  locale,
  sections,
  catalogFilters = null,
  unavailable = false,
  retryAfter = 0,
  onRetry,
}: {
  locale: Locale;
  sections: PublicHomeSection[];
  catalogFilters?: PublicVehicleFilters['data'] | null;
  unavailable?: boolean;
  retryAfter?: number;
  onRetry?: () => void;
}) {
  const t = homeContent[locale];
  const [paused, setPaused] = useState(false);
  const visibleSections = unavailable
    ? []
    : sections.filter((section) => section.vehicles.length > 0);
  // Older APIs without an exact total returned a complete powertrain partition.
  const catalogCount = catalogFilters
    ? (catalogFilters.total ??
      catalogFilters.powertrains.reduce((total, powertrain) => total + powertrain.count, 0))
    : null;
  const brands =
    catalogFilters?.makes.filter((make) => make.count > 0).map((make) => make.name) ?? [];
  const models: HomeModel[] =
    catalogFilters?.models
      .filter((model) => model.count > 0)
      .flatMap((model) => {
        const representative = visibleSections
          .flatMap((section) => section.vehicles)
          .find(
            (vehicle) =>
              vehicle.facts.make?.id === model.makeId &&
              vehicle.facts.model?.id === model.id &&
              vehicle.images.length > 0,
          );
        if (!representative) return [];
        const image = publicVehicleCover(representative);
        if (!image) return [];
        return [
          {
            name: model.name,
            brand: catalogFilters.makes.find((make) => make.id === model.makeId)?.name ?? '',
            count: model.count,
            href: `/${locale}/cars/?${new URLSearchParams({ make: model.makeId, model: model.id }).toString()}`,
            image: {
              ...image,
              alt: image.alt || representative.content.title.text,
            },
          },
        ];
      }) ?? [];
  return (
    <main id="main" className={styles.home} data-testid="home-page" data-motion-paused={paused}>
      <section className={styles.hero} data-home-section="hero">
        <HeroCanvas paused={paused} />
        <div className={styles.heroContent}>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
          <Link className={styles.catalogButton} href="/cars/">
            <span>{t.catalog}</span>
          </Link>
          <div className={styles.heroPhone}>
            <a href={siteConfig.contacts.phone.href}>
              <Icon name="phone" size={14} />
              {siteConfig.contacts.phone.display}
            </a>
          </div>
          <HeroStats locale={locale} catalogCount={catalogCount} />
        </div>
        <a className={styles.scroll} href="#home-shortcuts">
          <span>{t.scroll}</span>
          <span aria-hidden="true">
            <Icon name="chevron" size={24} />
            <Icon name="chevron" size={24} />
          </span>
        </a>
        <button
          className={styles.motionToggle}
          type="button"
          aria-label={paused ? t.resume : t.pause}
          aria-pressed={paused}
          onClick={() => setPaused((x) => !x)}
        >
          {paused ? '▷' : 'Ⅱ'}
        </button>
      </section>
      <section className={styles.shortcuts} id="home-shortcuts" data-home-section="shortcuts">
        <Link href="/cars/" className={styles.shortcut}>
          <Icon name="car" size={30} />
          <strong>{t.shortcuts[0]}</strong>
          <span>{t.shortcutNotes[0]}</span>
          <Icon name="arrow" size={16} />
        </Link>
        <Link href="/parts/" className={styles.shortcut}>
          <Icon name="box" size={30} />
          <strong>{t.shortcuts[1]}</strong>
          <span>{t.shortcutNotes[1]}</span>
          <Icon name="arrow" size={16} />
        </Link>
        <Link href="/calculator/russia/" className={styles.shortcut}>
          <Icon name="calculator" size={30} />
          <strong>{t.shortcuts[2]}</strong>
          <span>{t.shortcutNotes[2]}</span>
          <Icon name="arrow" size={16} />
        </Link>
      </section>
      {visibleSections.map((section) => (
        <VehicleRail key={section.id} section={section} locale={locale} paused={paused} />
      ))}
      {(unavailable || visibleSections.length === 0) && (
        <section
          className={styles.catalogState}
          data-testid={unavailable ? 'home-catalog-error' : 'home-catalog-empty'}
          aria-live="polite"
        >
          <Icon name={unavailable ? 'refresh' : 'car'} size={32} />
          <h2>{unavailable ? t.catalogUnavailable : t.catalogEmpty}</h2>
          <p>{unavailable ? t.catalogUnavailableBody : t.catalogEmptyBody}</p>
          {unavailable ? (
            <>
              <a
                href={retryAfter > 0 ? undefined : `/${locale}/`}
                aria-disabled={retryAfter > 0 || undefined}
                onClick={(event) => {
                  if (retryAfter > 0 || onRetry) event.preventDefault();
                  if (retryAfter <= 0) onRetry?.();
                }}
              >
                {t.retry}
              </a>
            </>
          ) : (
            <Link href="/cars/">{t.catalog}</Link>
          )}
        </section>
      )}
      {brands.length > 0 && (
        <div className={styles.brands} aria-label={brands.join(', ')}>
          <div className={styles.brandMarquee} data-paused={paused}>
            {[...brands, ...brands].map((brand, i) => (
              <span aria-hidden={i >= brands.length} key={`${brand}-${i}`}>
                {brand}
              </span>
            ))}
          </div>
        </div>
      )}
      <HomeSections locale={locale} models={models} paused={paused} />
    </main>
  );
}
