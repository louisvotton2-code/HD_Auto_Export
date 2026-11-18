import Image from 'next/image';
import type { CSSProperties } from 'react';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { Icon } from '@/shared/ui/icon';
import { NavigationLink } from '@/shared/ui/navigation-link';
import { AboutMotion } from './about-motion';
import { CompanyFilm } from './company-film';
import { getAboutContent } from './content';
import styles from './about.module.css';

const journeyImages = ['showroom', 'inspection', 'registration'] as const;

export async function AboutPage({ locale }: { locale: Locale }) {
  const copy = getAboutContent(locale);
  const contacts = await getTranslations({ locale, namespace: 'Contacts' });
  const formatArea = new Intl.NumberFormat(locale);
  const stats = [
    { value: '23', unit: locale === 'zh' ? '年' : '', label: copy.marketExperience },
    { value: formatArea.format(30_000), unit: copy.squareMetres, label: copy.marketArea },
    { value: `${formatArea.format(50_000)}+`, unit: copy.squareMetres, label: copy.warehouseArea },
  ];

  return (
    <AboutMotion className={styles.page}>
      <section className={styles.hero} aria-labelledby="about-title" data-about-hero>
        <div className={styles.heroMedia} aria-hidden="true">
          <Image
            src="/media/about/export-terminal.webp"
            alt=""
            fill
            preload
            sizes="100vw"
            className={styles.heroImage}
          />
        </div>
        <div className={styles.heroLight} aria-hidden="true" />
        <div className={`${styles.wrap} ${styles.heroContent}`}>
          <p className={styles.eyebrow}>{copy.location}</p>
          <h1 id="about-title">
            <span><span>{copy.headline[0]}</span></span>{' '}
            <span><em>{copy.headline[1]}</em></span>
          </h1>
          <p className={styles.heroIntro}>{copy.introduction}</p>
          <a href="#about-film" className={styles.heroFilm}>
            <span className={styles.playIcon}><Icon name="play" size={20} /></span>
            <span>{copy.watchFilm}</span>
          </a>
        </div>
        <div className={`${styles.wrap} ${styles.heroTrack}`}>
          <a href="#about-journey"><Icon name="chevron" size={17} />{copy.exploreJourney}</a>
          <div className={styles.trackLine} aria-hidden="true" />
        </div>
      </section>

      <section id="about-film" className={styles.screening} aria-labelledby="about-story-title">
        <div className={`${styles.wrap} ${styles.story}`}>
          <div className={styles.storyCopy}>
            <p className={styles.eyebrow}>{copy.filmLabel}</p>
            <h2 id="about-story-title">{copy.storyTitle}</h2>
            <p>{copy.storyBody}</p>
            <address><Icon name="pin" size={17} />{contacts('addressValue')}</address>
          </div>
          <figure className={styles.film}>
            <CompanyFilm label={copy.playFilm} />
            <figcaption>{copy.filmCaption}</figcaption>
          </figure>
        </div>
        <div className={styles.wrap}>
          <dl className={styles.stats}>
            {stats.map(({ value, unit, label }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}{unit && <small> {unit}</small>}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="about-journey" className={`${styles.wrap} ${styles.journey}`} aria-labelledby="about-journey-title">
        <header className={styles.journeyHeader}>
          <h2 id="about-journey-title">{copy.exportTitle}</h2>
          <p>{copy.journeyIntro}</p>
        </header>
        <ol className={styles.scenes} role="list">
          {copy.services.map(({ title, text, imageAlt }, index) => (
            <li
              key={title}
              className={styles.scene}
              style={{ '--scene-index': index } as CSSProperties}
              data-about-reveal
            >
              <div className={styles.sceneMedia}>
                <Image
                  src={`/media/about/journey-${journeyImages[index]}.webp`}
                  alt={imageAlt}
                  fill
                  sizes="(max-width: 760px) 92vw, (max-width: 1440px) 90vw, 1320px"
                  className={styles.sceneImage}
                />
              </div>
              <div className={styles.sceneCopy}>
                <span className={styles.sceneIndex} aria-hidden="true">
                  0{index + 1} <span>/ 0{copy.services.length}</span>
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${styles.wrap} ${styles.contact}`} aria-labelledby="about-contact-title">
        <div>
          <h2 id="about-contact-title">{copy.contactTitle}</h2>
          <p>{copy.contactBody}</p>
        </div>
        <div className={styles.actions}>
          <a href={siteConfig.contacts.whatsapp.href} className={styles.primary}>
            {copy.contactAction}<Icon name="diagonal" size={17} />
          </a>
          <NavigationLink href="/cars/" className={styles.secondary}>
            {copy.catalogAction}<Icon name="arrow" size={17} />
          </NavigationLink>
        </div>
      </section>
    </AboutMotion>
  );
}
