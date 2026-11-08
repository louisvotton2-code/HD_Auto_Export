import { getTranslations } from 'next-intl/server';
import { NavigationLink as Link } from '@/shared/ui/navigation-link';
import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { Icon } from '@/shared/ui/icon';
import { buyingGuideConfig } from '../config';
import styles from './buying-guide.module.css';

const steps = [
  { id: 'choose', icon: 'car' },
  { id: 'deposit', icon: 'shield' },
  { id: 'inspection', icon: 'info' },
  { id: 'balance', icon: 'check' },
  { id: 'export', icon: 'box' },
  { id: 'shipping', icon: 'globe' },
  { id: 'customs', icon: 'calculator' },
  { id: 'receive', icon: 'spark' },
] as const;
const questions = ['destinations', 'deposit', 'customs', 'insurance'] as const;

export async function BuyingGuidePage({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'BuyingGuide' });
  const nav = await getTranslations({ locale, namespace: 'Nav' });
  const text = (key: string) => t(key, { deposit: buyingGuideConfig.depositUsd });

  return (
    <main id="main" data-testid="buy-guide" className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero} aria-labelledby="buy-title" data-motion-reveal>
          <h1 id="buy-title">{text('metaTitle')}</h1>
          <p className={styles.intro}>{text('description')}</p>
        </section>

        <section id="buy-process" className={styles.process} aria-label={text('processLabel')}>
          <ol className={styles.steps} role="list">
            {steps.map(({ id, icon }, index) => (
              <li
                key={id}
                id={`buy-step-${id}`}
                data-testid="buy-step"
                data-motion-reveal
                className={styles.step}
              >
                <div className={styles.stepTop}>
                  <span className={styles.stepNumber}>
                    {t('stepLabel', { number: String(index + 1) })}
                  </span>
                  <span className={styles.stepIcon}>
                    <Icon name={icon} size={20} />
                  </span>
                </div>
                <div className={styles.stepContent}>
                  <h2>{text(`steps.${id}.title`)}</h2>
                  <p
                    className={styles.stepBody}
                    data-testid={id === 'deposit' ? 'buy-deposit' : undefined}
                  >
                    {text(`steps.${id}.body`)}
                  </p>
                  <p className={styles.stepNote}>{text(`steps.${id}.note`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="delivery" className={styles.delivery} aria-labelledby="delivery-title">
          <div className={styles.sectionHeading}>
            <h2 id="delivery-title">{text('termsTitle')}</h2>
            <p>{text('termsDescription')}</p>
          </div>
          <div className={styles.termsGrid}>
            {(['cif', 'fob'] as const).map((term) => (
              <section
                className={styles.term}
                key={term}
                data-testid={`shipping-${term}`}
                data-motion-reveal
                aria-labelledby={`${term}-title`}
              >
                <div className={styles.termTop}>
                  <span>{term.toUpperCase()}</span>
                  <Icon name={term === 'cif' ? 'shield' : 'globe'} size={27} />
                </div>
                <h3 id={`${term}-title`}>{text(`${term}Title`)}</h3>
                <p>{text(`${term}Body`)}</p>
                <ul>
                  {(['freight', 'insurance', 'customs'] as const).map((point) => (
                    <li key={point}>
                      <Icon name="check" size={15} />
                      <span>{text(`${term}Points.${point}`)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className={styles.riskNote}>
            <Icon name="info" size={18} />
            <span>{text('riskNote')}</span>
          </p>
        </section>

        <section
          data-testid="buy-faq"
          className={styles.faq}
          aria-labelledby="buy-faq-title"
          data-motion-reveal
        >
          <div className={styles.sectionHeading}>
            <h2 id="buy-faq-title">{text('faqTitle')}</h2>
          </div>
          <div className={styles.questions}>
            {questions.map((question) => (
              <section key={question} aria-labelledby={`buy-faq-${question}`}>
                <h3 id={`buy-faq-${question}`}>{text(`faq.${question}.question`)}</h3>
                <p>{text(`faq.${question}.answer`)}</p>
              </section>
            ))}
          </div>
        </section>

        <section className={styles.cta} aria-labelledby="buy-cta-title" data-motion-reveal>
          <h2 id="buy-cta-title">{text('ctaTitle')}</h2>
          <p>{text('ctaDescription')}</p>
          <div className={styles.actions}>
            <Link href="/cars/" className={styles.primaryButton}>
              {nav('vehicles')}
              <Icon name="arrow" size={17} />
            </Link>
            <a
              className={styles.secondaryButton}
              href={siteConfig.contacts.whatsapp.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {text('ctaContact')}
              <Icon name="diagonal" size={17} />
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
