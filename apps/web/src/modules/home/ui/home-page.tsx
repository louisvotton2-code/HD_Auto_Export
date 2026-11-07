'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/routing';
import { NavigationLink as Link } from '@/shared/ui/navigation-link';
import { siteConfig } from '@/shared/config/site';
import { Icon } from '@/shared/ui/icon';
import { SocialIcon } from '@/shared/ui/social-icon';
import { buildVehicleContactLinks } from '@/shared/lib/vehicle-contact';
import { HeroCanvas } from './hero-canvas';
import { HomeSections } from './home-sections';
import { usePointerTilt } from './use-pointer-tilt';
import styles from './home.module.css';
import type { HomeModel, HomeVehicle } from '../types';
import { homeContent } from '../content/home-content';

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}
function VehicleRail({
  brand,
  vehicles,
  locale,
  paused,
}: {
  brand: string;
  vehicles: HomeVehicle[];
  locale: Locale;
  paused: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [interacting, setInteracting] = useState(false);
  const pointerTilt = usePointerTilt();
  const t = homeContent[locale];
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
  }, [paused, interacting]);
  return (
    <section className={styles.brandSection} data-home-section={`vehicles-${brand.toLowerCase()}`}>
      <div className={styles.sectionHead}>
        <h2>{brand}</h2>
        <div className={styles.railControls}>
          <button type="button" onClick={() => advance(-1)} aria-label={`${brand} — ${t.previous}`}>
            ‹
          </button>
          <button type="button" onClick={() => advance(1)} aria-label={`${brand} — ${t.next}`}>
            ›
          </button>
        </div>
      </div>
      <div
        className={styles.vehicleRail}
        ref={rail}
        tabIndex={0}
        aria-label={`${brand} — ${t.catalog}`}
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
          const links = buildVehicleContactLinks(
            { ...v, id: v.slug, detailPath: `/${locale}/cars/${v.slug}/` },
            locale,
          );
          return (
            <div className={styles.vehicleSlot} key={v.slug}>
              <article className={styles.vehicleCard} data-pointer-tilt {...pointerTilt}>
                <div className={styles.cardLight} aria-hidden="true" />
                <div className={styles.vehicleImage}>
                  <Link href={`/cars/${v.slug}/`} tabIndex={-1} aria-hidden="true">
                    <Image
                      src={v.image}
                      alt={v.imageAlt}
                      width={640}
                      height={400}
                      sizes="(max-width: 639px) calc(100vw - 32px), (max-width: 1023px) 48vw, 404px"
                    />
                  </Link>
                  <button
                    type="button"
                    className={styles.save}
                    aria-label={saved.includes(v.slug) ? t.saved : t.save}
                    aria-pressed={saved.includes(v.slug)}
                    onClick={() =>
                      setSaved((items) =>
                        items.includes(v.slug)
                          ? items.filter((x) => x !== v.slug)
                          : [...items, v.slug],
                      )
                    }
                  >
                    <Heart filled={saved.includes(v.slug)} />
                  </button>
                  <span className={styles.year}>{v.year}</span>
                </div>
                <div className={styles.vehicleBody}>
                  <h3 title={v.model}>{v.model}</h3>
                  <p className={styles.make}>{v.make}</p>
                  <div className={styles.specs}>
                    <span>{v.mileageKm.toLocaleString(locale)} km</span>
                    <span>{t.fuels[v.fuel as keyof typeof t.fuels] ?? v.fuel}</span>
                    <span>{v.transmission === 'manual' ? t.manual : t.auto}</span>
                  </div>
                  <div className={styles.price}>
                    <span>{t.price}</span>
                    <strong>$ {v.priceUsd.toLocaleString('en-US')} USD</strong>
                    <small>
                      {v.referencePriceKrw
                        ? `₩ ${v.referencePriceKrw.toLocaleString('en-US')} KRW`
                        : 'USD'}
                    </small>
                  </div>
                  <p className={styles.priceNote}>{t.note}</p>
                  <span className={styles.demo}>{t.demo}</span>
                  <div className={styles.cardContact} data-vehicle-contacts={v.slug}>
                    <a
                      href={links.telegram}
                      aria-label={`Telegram — ${v.make} ${v.model}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <SocialIcon platform="telegram" size={20} />
                    </a>
                    <a
                      href={links.whatsapp}
                      aria-label={`WhatsApp — ${v.make} ${v.model}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <SocialIcon platform="whatsapp" size={20} />
                    </a>
                    <Link className={styles.details} href={`/cars/${v.slug}/`}>
                      {t.details}
                      <Icon name="arrow" size={14} />
                    </Link>
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
  vehicles,
  models,
}: {
  locale: Locale;
  vehicles: HomeVehicle[];
  models: HomeModel[];
}) {
  const t = homeContent[locale],
    dialog = useRef<HTMLDialogElement>(null);
  const [paused, setPaused] = useState(false);
  const brands = ['KIA', 'HYUNDAI', 'GENESIS', 'BMW', 'MERCEDES-BENZ', 'AUDI', 'PORSCHE'];
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
          <div className={styles.stats}>
            {[vehicles.length, 7, 3].map((value, i) => (
              <div key={t.stats[i]}>
                <strong>{value}</strong>
                <span>{t.stats[i]}</span>
              </div>
            ))}
          </div>
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
        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          className={styles.shortcut}
        >
          <Icon name="box" size={30} />
          <strong>{t.shortcuts[1]}</strong>
          <span>{t.shortcutNotes[1]}</span>
          <Icon name="arrow" size={16} />
        </button>
        <Link href="/calculator/russia/" className={styles.shortcut}>
          <Icon name="calculator" size={30} />
          <strong>{t.shortcuts[2]}</strong>
          <span>{t.shortcutNotes[2]}</span>
          <Icon name="arrow" size={16} />
        </Link>
      </section>
      {['Kia', 'Hyundai'].map((brand) => (
        <VehicleRail
          key={brand}
          brand={brand}
          vehicles={vehicles.filter(
            (v) =>
              v.make.toLowerCase() === brand.toLowerCase() &&
              v.referencePriceKrw &&
              !v.image.endsWith('.svg'),
          )}
          locale={locale}
          paused={paused}
        />
      ))}
      <div
        className={styles.brands}
        aria-label="Kia, Hyundai, Genesis, BMW, Mercedes-Benz, Audi, Porsche"
      >
        <div className={styles.brandMarquee} data-paused={paused}>
          {[...brands, ...brands].map((brand, i) => (
            <span aria-hidden={i >= brands.length} key={`${brand}-${i}`}>
              {brand}
            </span>
          ))}
        </div>
      </div>
      <HomeSections locale={locale} models={models} paused={paused} />
      <dialog
        ref={dialog}
        className={styles.comingSoon}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <h2>{t.soon}</h2>
        <p>{t.soonBody}</p>
        <a href={siteConfig.contacts.whatsapp.href} target="_blank" rel="noreferrer">
          {t.contact} ↗
        </a>
        <button type="button" onClick={() => dialog.current?.close()}>
          {t.close}
        </button>
      </dialog>
    </main>
  );
}
