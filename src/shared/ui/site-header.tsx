'use client';

import { useLocale, useTranslations } from 'next-intl';
import Image from 'next/image';
import { usePathname } from '@/i18n/navigation';
import { NavigationLink as Link } from '@/shared/ui/navigation-link';
import { routing } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { Icon } from './icon';

export function SiteHeader() {
  const locale = useLocale();
  const t = useTranslations();
  const pathname = usePathname();
  const calculatorActive = pathname === '/calculator' || pathname.startsWith('/calculator/');
  const buyActive = pathname.replace(/\/$/, '') === '/buy';
  return (
    <header className="site-header hd-header">
      <div className="header-inner">
        <Link
          href="/calculator/russia/"
          className="brand hd-brand"
          aria-label={`${siteConfig.name} — ${t('Nav.home')}`}
        >
          <Image
            src={siteConfig.brand.logo.src}
            width={siteConfig.brand.logo.width}
            height={siteConfig.brand.logo.height}
            alt={t('Brand.logoAlt')}
            sizes="(max-width: 740px) 57px, 76px"
            className="hd-brand-logo"
            loading="eager"
          />
          <span className="hd-brand-type">
            {t('Brand.name')}
            <small>{t('Brand.tagline')}</small>
          </span>
        </Link>
        <nav className="main-nav" aria-label={t('Nav.menu')}>
          <Link
            href="/calculator/russia/"
            className={calculatorActive ? 'nav-active' : undefined}
            aria-current={calculatorActive ? 'page' : undefined}
          >
            <Icon name="calculator" size={17} />
            {t('Nav.calculator')}
          </Link>
          <Link
            href="/buy/"
            className={buyActive ? 'nav-active' : undefined}
            aria-current={buyActive ? 'page' : undefined}
          >
            <Icon name="car" size={17} />
            {t('BuyingGuide.navLabel')}
          </Link>
          <a href={siteConfig.companyWebsite}>{t('Nav.about')}</a>
          <a href="#contact">{t('Nav.contact')}</a>
        </nav>
        <div className="header-tools">
          <span className="export-origin">
            <span className="status-dot" />
            {t('Common.fromChina')}
          </span>
          <nav className="language-switch" aria-label={t('Common.language')}>
            {routing.locales.map((l) => (
              <Link
                key={l}
                href={`${pathname.replace(/\/$/, '')}/`}
                locale={l}
                hrefLang={l === 'zh' ? 'zh-Hans' : l}
                aria-current={locale === l ? 'page' : undefined}
                lang={l}
                className={locale === l ? 'selected' : ''}
              >
                {l === 'zh' ? '中文' : l.toUpperCase()}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
