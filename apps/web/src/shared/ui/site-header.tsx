'use client';

import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { hasLocale, useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname } from '@/i18n/navigation';
import { NavigationLink as Link } from '@/shared/ui/navigation-link';
import { routing, type Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { CountryFlag, type FlagCountryCode } from './country-flag';
import { DestinationCalculatorLink } from './destination-calculator-link';
import { Icon } from './icon';
import styles from './site-shell.module.css';

const languageFlags = { zh: 'CN', en: 'GB', ru: 'RU' } as const satisfies Record<Locale, FlagCountryCode>;
const marketPath = '/market-prices/';

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'instant' });
}

type LanguageOptionsProps = { href: string; locale: string; onClick: () => void };

function LanguageOptions({ href, locale, onClick }: LanguageOptionsProps) {
  return routing.locales.map((language) => (
    <Link
      key={language}
      href={href}
      locale={language}
      hrefLang={language === 'zh' ? 'zh-Hans' : language}
      aria-current={locale === language ? 'page' : undefined}
      lang={language}
      className={locale === language ? 'selected' : undefined}
      onClick={onClick}
    >
      <CountryFlag countryCode={languageFlags[language]} className={styles.languageFlag} />
      {language === 'zh' ? '中文' : language.toUpperCase()}
    </Link>
  ));
}

function MarketLanguageOptions(props: Omit<LanguageOptionsProps, 'href'>) {
  const search = useSearchParams()?.toString() ?? '';
  return <LanguageOptions {...props} href={search ? `${marketPath}?${search}` : marketPath} />;
}

export function SiteHeader({ favoriteAction }: { favoriteAction?: ReactNode }) {
  const locale = useLocale();
  const t = useTranslations();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLElement>(null);
  const mobileMenu = useRef<HTMLDetailsElement>(null);
  const languageMenu = useRef<HTMLDetailsElement>(null);
  const scrollHomeOnNavigation = useRef(false);
  const activeLanguage = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const calculatorActive = pathname === '/calculator' || pathname.startsWith('/calculator/');
  const carsActive = pathname === '/cars' || pathname.startsWith('/cars/');
  const buyActive = pathname.replace(/\/$/, '') === '/buy';
  const aboutActive = pathname.replace(/\/$/, '') === '/about';
  const partsActive = pathname === '/parts' || pathname.startsWith('/parts/');
  const languagePath = `${pathname.replace(/\/$/, '')}/`;
  const marketActive = languagePath === marketPath;

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 16);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    if (mobileMenu.current) mobileMenu.current.open = false;
    if (languageMenu.current) languageMenu.current.open = false;
  }, [pathname, locale]);

  useLayoutEffect(() => {
    if (!scrollHomeOnNavigation.current) return;
    scrollHomeOnNavigation.current = false;
    if (pathname === '/') scrollToTop();
  }, [pathname, locale]);

  function closeMenu() {
    setMenuOpen(false);
    if (mobileMenu.current) mobileMenu.current.open = false;
  }

  const navigationLinks = (
    <>
      <Link
        href="/cars/"
        className={carsActive ? 'nav-active' : undefined}
        aria-current={carsActive ? 'page' : undefined}
        onClick={closeMenu}
      >
        {t('Nav.vehicles')}
      </Link>
      <Link
        href="/parts/"
        className={partsActive ? 'nav-active' : undefined}
        aria-current={partsActive ? 'page' : undefined}
        onClick={closeMenu}
      >
        {t('Nav.parts')}
      </Link>
      <DestinationCalculatorLink
        className={calculatorActive ? 'nav-active' : undefined}
        aria-current={calculatorActive ? 'page' : undefined}
        onClick={closeMenu}
      >
        {t('Nav.calculator')}
      </DestinationCalculatorLink>
      <Link
        href="/buy/"
        className={buyActive ? 'nav-active' : undefined}
        aria-current={buyActive ? 'page' : undefined}
        onClick={closeMenu}
      >
        {t('BuyingGuide.navLabel')}
      </Link>
      <Link
        className="nav-utility"
        href="/about/"
        aria-current={aboutActive ? 'page' : undefined}
        onClick={closeMenu}
      >
        {t('Nav.about')}
      </Link>
      <Link
        href={marketPath}
        className={marketActive ? 'nav-active' : undefined}
        aria-current={marketActive ? 'page' : undefined}
        onClick={closeMenu}
      >
        {t('Nav.marketPrices')}
      </Link>
    </>
  );

  return (
    <header
      className={`site-header hd-header ${styles.header}`}
      data-scrolled={scrolled || menuOpen}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (menuOpen) menuButton.current?.focus();
          closeMenu();
          if (languageMenu.current) languageMenu.current.open = false;
        }
      }}
    >
      <div className={`header-inner ${styles.headerInner}`}>
        <Link
          href="/"
          scroll={false}
          className={`brand hd-brand ${styles.brand}`}
          aria-label={`${siteConfig.name} — ${t('Nav.home')}`}
          onClick={closeMenu}
          onNavigate={(event) => {
            if (pathname === '/') {
              event.preventDefault();
              if (languageMenu.current) languageMenu.current.open = false;
              const { search, hash } = window.location;
              if (search || hash) {
                window.history.replaceState(null, '', window.location.pathname);
              }
              scrollToTop();
              // A smooth anchor scroll can still apply its last queued position on the next frame.
              if (hash) window.requestAnimationFrame(scrollToTop);
            } else {
              // Scroll after the destination commits so the departed page retains its position.
              scrollHomeOnNavigation.current = true;
            }
          }}
        >
          <img
            src={siteConfig.brand.logo.src}
            width={siteConfig.brand.logo.width}
            height={siteConfig.brand.logo.height}
            alt={t('Brand.logoAlt')}
            className={styles.logo}
            loading="eager"
          />
          <span className={styles.brandName}>
            HD <span>Auto Export</span>
          </span>
        </Link>
        <nav className={`main-nav ${styles.mainNav}`} aria-label={t('Nav.menu')}>
          {navigationLinks}
        </nav>
        <div className={`header-tools ${styles.headerTools}`}>
          {favoriteAction}
          <nav
            className={`language-switch ${styles.languageSwitch}`}
            aria-label={t('Common.language')}
          >
            <details ref={languageMenu} className={styles.languageMenu}>
              <summary aria-label={t('Common.language')}>
                <CountryFlag countryCode={languageFlags[activeLanguage]} className={styles.languageFlag} />
                <span>{activeLanguage === 'zh' ? '中文' : activeLanguage.toUpperCase()}</span>
                <Icon name="chevron" size={13} />
              </summary>
              <div className={styles.languageOptions}>
                {marketActive ? (
                  <Suspense fallback={<LanguageOptions href={marketPath} locale={locale} onClick={closeMenu} />}>
                    <MarketLanguageOptions locale={locale} onClick={closeMenu} />
                  </Suspense>
                ) : <LanguageOptions href={languagePath} locale={locale} onClick={closeMenu} />}
              </div>
            </details>
          </nav>
          <details
            ref={mobileMenu}
            className={styles.mobileMenu}
            onToggle={(event) => setMenuOpen(event.currentTarget.open)}
          >
            <summary
              ref={menuButton}
              className={styles.menuButton}
              aria-label={t('Nav.menu')}
              aria-controls="site-mobile-nav"
            >
              <span className={styles.menuGlyph}>
                <Icon name="menu" size={23} />
              </span>
              <svg
                className={styles.closeGlyph}
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </summary>
            <nav
              id="site-mobile-nav"
              className={`main-nav ${styles.mobileNav}`}
              aria-label={t('Nav.menu')}
            >
              {navigationLinks}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
