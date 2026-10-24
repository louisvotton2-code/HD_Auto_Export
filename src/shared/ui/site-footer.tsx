import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { siteConfig } from '@/shared/config/site';
import { ContactLinks } from './contact-links';

export async function SiteFooter() {
  const t = await getTranslations();
  const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Shanghai' }).format(
    new Date(),
  );
  return (
    <footer className="site-footer hd-footer" id="contact">
      <div className="footer-inner hd-footer-inner">
        <div className="hd-footer-main">
          <div className="hd-footer-about">
            <Link
              href="/calculator"
              className="hd-footer-brand"
              aria-label={`${siteConfig.name} — ${t('Nav.home')}`}
            >
              <Image
                src={siteConfig.brand.logo.src}
                width={siteConfig.brand.logo.width}
                height={siteConfig.brand.logo.height}
                alt={t('Brand.logoAlt')}
                sizes="88px"
                className="hd-footer-logo"
              />
              <strong>{siteConfig.name}</strong>
            </Link>
            <p>{t('Footer.description')}</p>
            <nav className="hd-footer-nav" aria-label={t('Nav.menu')}>
              <Link href="/calculator">{t('Nav.calculator')}</Link>
              <Link href="/buy">{t('BuyingGuide.navLabel')}</Link>
            </nav>
          </div>
          <section className="hd-contacts" aria-labelledby="contact-title">
            <h2 id="contact-title">{t('Contacts.title')}</h2>
            <ContactLinks />
          </section>
        </div>
        <div className="hd-footer-bottom">
          <small>{t('Footer.copyright', { year })}</small>
          <span>{t('Footer.note')}</span>
        </div>
      </div>
    </footer>
  );
}
