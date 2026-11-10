import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { NavigationLink as Link } from '@/shared/ui/navigation-link';
import { siteConfig } from '@/shared/config/site';
import { ContactLinks } from './contact-links';
import { FooterPayment } from './footer-payment';
import { Icon } from './icon';
import styles from './site-shell.module.css';

export async function SiteFooter() {
  const t = await getTranslations();
  const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Shanghai' }).format(
    new Date(),
  );
  return (
    <footer className={`site-footer hd-footer ${styles.footer}`} id="contact">
      <div className={styles.footerAccent} aria-hidden="true" />
      <div className={`footer-inner hd-footer-inner ${styles.footerInner}`}>
        <div className={`hd-footer-main ${styles.footerGrid}`}>
          <div className={`hd-footer-about ${styles.footerAbout}`}>
            <Link
              href="/"
              className={`hd-footer-brand ${styles.footerBrand}`}
              aria-label={`${siteConfig.name} — ${t('Nav.home')}`}
            >
              <Image
                src={siteConfig.brand.logo.src}
                width={siteConfig.brand.logo.width}
                height={siteConfig.brand.logo.height}
                alt={t('Brand.logoAlt')}
                sizes="49px"
                className={styles.footerLogo}
              />
              <strong>
                HD <span>Auto Export</span>
              </strong>
            </Link>
            <p>{t('Footer.description')}</p>
            <p className={styles.exportOrigin}>
              <Icon name="globe" size={15} />
              {t('Common.fromChina')}
            </p>
            <address className={`hd-contact-address ${styles.address}`}>
              <Icon name="pin" size={15} />
              <span>
                <strong>{t('Contacts.addressLabel')}</strong>
                {t('Contacts.addressValue')}
              </span>
            </address>
          </div>
          <section className={styles.footerNavigation}>
            <h2>{t('Nav.menu')}</h2>
            <nav className={`hd-footer-nav ${styles.footerNav}`} aria-label={t('Nav.menu')}>
              <Link href="/">{t('Nav.home')}</Link>
              <Link href="/cars/">{t('Nav.vehicles')}</Link>
              <Link href="/parts/">{t('Nav.parts')}</Link>
              <Link href="/calculator/russia/">{t('Nav.calculator')}</Link>
              <Link href="/buy/">{t('BuyingGuide.navLabel')}</Link>
              <a href={siteConfig.companyWebsite}>{t('Nav.about')}</a>
              <a href="#contact">{t('Nav.contact')}</a>
            </nav>
          </section>
          <section
            className={`hd-contacts ${styles.footerContacts}`}
            aria-labelledby="contact-title"
          >
            <h2 id="contact-title">{t('Contacts.title')}</h2>
            <ContactLinks />
            <FooterPayment
              title={t('Contacts.payment')}
              bankTransfer={t('Contacts.bankTransfer')}
              note={t('Contacts.confirmPayment')}
            />
          </section>
        </div>
        <div className={`hd-footer-bottom ${styles.footerBottom}`}>
          <small>{t('Footer.copyright', { year })}</small>
          <span>{t('Footer.note')}</span>
        </div>
      </div>
    </footer>
  );
}
