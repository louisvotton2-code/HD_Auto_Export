'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Image from 'next/image';
import { usePathname } from '@/i18n/navigation';
import { NavigationLink as Link } from '@/shared/ui/navigation-link';
import { routing } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { Icon } from './icon';
import styles from './site-shell.module.css';

export function SiteHeader({ favoriteAction, enquiryAction }: { favoriteAction?: ReactNode; enquiryAction?: ReactNode }) {
  const locale = useLocale();
  const t = useTranslations();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLElement>(null);
  const mobileMenu = useRef<HTMLDetailsElement>(null);
  const languageMenu = useRef<HTMLDetailsElement>(null);
  const calculatorActive = pathname === '/calculator' || pathname.startsWith('/calculator/');
  const carsActive = pathname === '/cars' || pathname.startsWith('/cars/');
  const buyActive = pathname.replace(/\/$/, '') === '/buy';
  const partsActive = pathname === '/parts' || pathname.startsWith('/parts/');

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
      <Link
        href="/calculator/russia/"
        className={calculatorActive ? 'nav-active' : undefined}
        aria-current={calculatorActive ? 'page' : undefined}
        onClick={closeMenu}
      >
        {t('Nav.calculator')}
      </Link>
      <Link
        href="/buy/"
        className={buyActive ? 'nav-active' : undefined}
        aria-current={buyActive ? 'page' : undefined}
        onClick={closeMenu}
      >
        {t('BuyingGuide.navLabel')}
      </Link>
      <a className="nav-utility" href={siteConfig.companyWebsite} onClick={closeMenu}>
        {t('Nav.about')}
      </a>
      <a className="nav-utility" href="#contact" onClick={closeMenu}>
        {t('Nav.contact')}
      </a>
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
          className={`brand hd-brand ${styles.brand}`}
          aria-label={`${siteConfig.name} — ${t('Nav.home')}`}
          onClick={closeMenu}
        >
          <Image
            src={siteConfig.brand.logo.src}
            width={siteConfig.brand.logo.width}
            height={siteConfig.brand.logo.height}
            alt={t('Brand.logoAlt')}
            sizes="54px"
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
                <Icon name="globe" size={16} />
                <span>{locale === 'zh' ? '中文' : locale.toUpperCase()}</span>
                <Icon name="chevron" size={13} />
              </summary>
              <div className={styles.languageOptions}>
                {routing.locales.map((language) => (
                  <Link
                    key={language}
                    href={`${pathname.replace(/\/$/, '')}/`}
                    locale={language}
                    hrefLang={language === 'zh' ? 'zh-Hans' : language}
                    aria-current={locale === language ? 'page' : undefined}
                    lang={language}
                    className={locale === language ? 'selected' : undefined}
                    onClick={closeMenu}
                  >
                    {language === 'zh' ? '中文' : language.toUpperCase()}
                  </Link>
                ))}
              </div>
            </details>
          </nav>
          {enquiryAction ?? <a
            className={styles.contactButton}
            href={siteConfig.contacts.whatsapp.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('Contacts.whatsapp')}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M20.8 11.5a8.8 8.8 0 0 1-13 7.8L3 21l1.6-4.7a8.8 8.8 0 1 1 16.2-4.8Z" />
              <path
                d="M8.2 7.2c-.8 1.1.2 3.8 2 5.5s4.2 2.5 5.4 1.7l.7-1.3-2.2-1.2-.9.8a7.8 7.8 0 0 1-3-3l.8-.9-1.2-2.2-1.6.6Z"
                strokeLinejoin="round"
              />
            </svg>
          </a>}
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
