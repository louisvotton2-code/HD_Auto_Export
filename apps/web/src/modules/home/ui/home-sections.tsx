'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { Icon } from '@/shared/ui/icon';
import { SocialIcon } from '@/shared/ui/social-icon';
import { CountryFlag } from '@/shared/ui/country-flag';
import { DestinationCalculatorLink } from '@/shared/ui/destination-calculator-link';
import { VehiclePhoto } from '@/modules/vehicles';
import { sectionContent } from '../content/section-content';
import styles from './home-sections.module.css';
import type { HomeModel } from '../types';

function BenefitIcon({ index }: { index: number }) {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 4 6 14v20l18 10 18-10V14L24 4Z" fill="#b67749" />
      {index === 0 ? (
        <path
          d="m17 24 6 6 10-11"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : index === 1 ? (
        <g stroke="white" strokeWidth="2.3" strokeLinecap="round">
          <circle cx="24" cy="23" r="8" />
          <path d="M24 18v5l4 2" />
        </g>
      ) : (
        <g stroke="white" strokeWidth="2" strokeLinejoin="round">
          <path d="M14 20h15v12H14V20Zm15 4h5l3 4v4h-8v-8Z" />
          <circle cx="19" cy="32" r="3" fill="#b67749" />
          <circle cx="33" cy="32" r="3" fill="#b67749" />
        </g>
      )}
    </svg>
  );
}

function ConsultationCard({
  locale,
  index,
  expanded = false,
}: {
  locale: Locale;
  index: number;
  expanded?: boolean;
}) {
  const t = sectionContent[locale];
  const chat = t.chats[index];
  return (
    <span className={`${styles.chat} ${expanded ? styles.chatExpanded : ''}`}>
      <span className={styles.chatHeader}>
        <span className={styles.chatAvatar} aria-hidden="true">
          HD
        </span>
        <span className={styles.chatIdentity}>
          <strong>{siteConfig.name}</strong>
          <small>{t.consultationLabel}</small>
        </span>
      </span>
      <span className={styles.chatBody}>
        {chat.questions.map((item) => (
          <span className={styles.questionPair} key={item.question}>
            <span className={styles.chatBubble} data-kind="question">
              <span className={styles.answerLabel}>{t.questionLabel}</span>
              <span>{item.question}</span>
            </span>
            <span className={styles.chatBubble} data-kind="answer">
              <span className={styles.answerLabel}>{t.answerLabel}</span>
              <span>{item.answer}</span>
            </span>
          </span>
        ))}
      </span>
      <span className={styles.chatFooter}>{siteConfig.name} · {t.consultationLabel}</span>
    </span>
  );
}

/** Editorial service sections backed by the public vehicle catalog. */
export function HomeSections({
  locale,
  models,
}: {
  locale: Locale;
  models: HomeModel[];
}) {
  const t = sectionContent[locale];
  const contacts = useTranslations('Contacts');
  const modelsRef = useRef<HTMLDivElement>(null);
  const modelStops = useRef<number[]>([]);
  const leadingModel = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [modelPage, setModelPage] = useState({ index: 0, count: 0 });
  const [selectedChat, setSelectedChat] = useState(0);

  useEffect(() => {
    const track = modelsRef.current;
    if (!track) {
      modelStops.current = [];
      leadingModel.current = 0;
      return;
    }
    let width = 0;

    const updatePage = () => {
      const stops = modelStops.current;
      const nearest = stops.findIndex(
        (left, position) => position === stops.length - 1 || track.scrollLeft <= (left + stops[position + 1]) / 2,
      );
      const index = Math.max(0, nearest);
      leadingModel.current = index;
      setModelPage((page) => page.index === index && page.count === stops.length
        ? page
        : { index, count: stops.length });
    };

    const measure = () => {
      if (track.clientWidth === width) return;
      width = track.clientWidth;
      const max = Math.max(0, track.scrollWidth - width);
      const first = track.firstElementChild?.getBoundingClientRect().left ?? 0;
      // Several desktop cards can be visible at the last reachable scroll position.
      const positions = Array.from(track.children, (card) =>
        Math.min(max, card.getBoundingClientRect().left - first));
      const stops = positions.filter((left, index) => index === 0 || left > positions[index - 1] + 1);
      const position = stops[Math.min(leadingModel.current, stops.length - 1)] ?? 0;
      modelStops.current = stops;
      if (Math.abs(track.scrollLeft - position) > 1) track.scrollTo({ left: position, behavior: 'instant' });
      updatePage();
    };

    measure();
    track.addEventListener('scroll', updatePage, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => {
      observer.disconnect();
      track.removeEventListener('scroll', updatePage);
    };
  }, [models.length]);

  const goToModel = (index: number) => {
    const track = modelsRef.current;
    const left = modelStops.current[index];
    if (!track || left === undefined) return;
    track.scrollTo({
      left,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };

  return (
    <div className={styles.sections}>
      {models.length > 0 && (
        <section
          className={styles.popular}
          aria-labelledby="popular-models-title"
          data-home-section="popular-models"
        >
          <div className={styles.container}>
            <div className={styles.popularHeading}>
              <div>
                <h2 id="popular-models-title">{t.popular}</h2>
                <p>{t.popularBody}</p>
              </div>
              <Link className={styles.catalogLink} href={`/${locale}/cars/`}>
                {t.catalog}<Icon name="arrow" size={16} />
              </Link>
            </div>
            <div
              ref={modelsRef}
              id="popular-models-track"
              className={styles.modelsTrack}
              aria-label={t.popular}
              tabIndex={0}
            >
              {models.map((model, index) => (
                <Link
                  className={styles.modelCard}
                  href={model.href}
                  key={`${model.brand}-${model.name}-${index}`}
                >
                  <span className={styles.modelPhoto}>
                    <VehiclePhoto image={model.image} locale={locale} alt={model.image.alt} layout="rail" />
                  </span>
                  <span className={styles.modelBody}>
                    <span className={styles.modelBrand}>{model.brand}</span>
                    <strong className={styles.modelName}>{model.name}</strong>
                    <span className={styles.modelSubtitle}>{t.modelScope}</span>
                    <span className={styles.modelBottom}>
                      <span>
                        <small>{t.modelRecords}</small>
                        <strong>{model.count.toLocaleString(locale)}</strong>
                      </span>
                      <span className={styles.modelMore}>{t.learn}<Icon name="arrow" size={16} /></span>
                    </span>
                  </span>
                </Link>
              ))}
            </div>
            {modelPage.count > 1 && (
              <div className={styles.pagination}>
                <button
                  type="button"
                  className={styles.modelPrevious}
                  aria-label={t.previous}
                  aria-controls="popular-models-track"
                  aria-disabled={modelPage.index === 0 || undefined}
                  onClick={() => goToModel(modelPage.index - 1)}
                >
                  <Icon name="chevron-left" size={20} />
                </button>
                <span className={styles.modelCount} aria-live="polite" aria-atomic="true" data-testid="home-model-count">
                  <strong>{(modelPage.index + 1).toLocaleString(locale)}</strong>
                  {' / '}{modelPage.count.toLocaleString(locale)}
                </span>
                <div className={styles.dots}>
                  {Array.from({ length: modelPage.count }, (_, index) => (
                    <button
                      key={index}
                      className={styles.dot}
                      aria-controls="popular-models-track"
                      aria-label={`${t.slide} ${(index + 1).toLocaleString(locale)}`}
                      aria-current={modelPage.index === index ? 'true' : undefined}
                      onClick={() => goToModel(index)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.modelNext}
                  aria-label={t.next}
                  aria-controls="popular-models-track"
                  aria-disabled={modelPage.index === modelPage.count - 1 || undefined}
                  onClick={() => goToModel(modelPage.index + 1)}
                >
                  <Icon name="chevron-right" size={20} />
                </button>
              </div>
            )}
            <Link className={styles.mobileCatalog} href={`/${locale}/cars/`}>
              {t.catalog}<Icon name="arrow" size={16} />
            </Link>
          </div>
        </section>
      )}

      <section className={styles.why} aria-labelledby="why-hd-title" data-home-section="why">
        <div className={styles.container}>
          <h2 className={styles.sectionTitle} id="why-hd-title">
            {t.why}
          </h2>
          <div className={styles.benefits}>
            {t.benefits.map((benefit, index) => (
              <article className={styles.benefit} key={benefit.title}>
                <BenefitIcon index={index} />
                <h3>{benefit.title}</h3>
                <p>{benefit.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        className={styles.process}
        aria-labelledby="home-process-title"
        data-home-section="buying-process"
      >
        <div className={styles.container}>
          <h2 className={styles.sectionTitle} id="home-process-title">
            {t.process}
          </h2>
          <div className={styles.stepTrack} tabIndex={0} aria-label={t.process}>
            {t.steps.map((step, index) => (
              <article className={styles.step} key={step.title}>
                <span className={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                <ul>
                  {step.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        className={styles.reviews}
        aria-labelledby="home-conversations-title"
        data-home-section="reviews"
      >
        <div className={styles.container}>
          <header className={styles.reviewHeading}>
            <h2 id="home-conversations-title">
              {t.conversations} <span>{t.conversationsAccent}</span>
            </h2>
            <p>{t.conversationsBody}</p>
          </header>
          <div
            className={styles.reviewTrack}
            tabIndex={0}
            aria-label={`${t.conversations} ${t.conversationsAccent}`}
          >
            {t.chats.map((chat, index) => (
              <button
                className={styles.reviewCard}
                type="button"
                key={chat.title}
                aria-label={`${t.open}: ${chat.title}`}
                onClick={() => {
                  setSelectedChat(index);
                  dialogRef.current?.showModal();
                }}
              >
                <span className={styles.reviewImage}>
                  <ConsultationCard locale={locale} index={index} />
                  <span className={styles.enlarge} aria-hidden="true">
                    <Icon name="diagonal" size={18} />
                  </span>
                </span>
                <span className={styles.reviewCaption}>{chat.title}</span>
              </button>
            ))}
          </div>
        </div>
        <dialog
          ref={dialogRef}
          className={styles.dialog}
          aria-labelledby="home-consultation-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) dialogRef.current?.close();
          }}
        >
          <div className={styles.dialogToolbar}>
            <h3 id="home-consultation-title">{t.chats[selectedChat].title}</h3>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label={t.close}>
              <Icon name="close" size={20} />
            </button>
          </div>
          <ConsultationCard locale={locale} index={selectedChat} expanded />
        </dialog>
      </section>

      <section
        className={styles.calculator}
        aria-labelledby="home-calculator-title"
        data-home-section="calculator"
      >
        <div className={styles.calculatorWrap}>
          <div className={styles.calculatorPanel}>
            <span className={styles.calculatorIcon}>
              <Icon name="calculator" size={32} />
            </span>
            <div className={styles.calculatorCopy}>
              <p className={styles.toolLabel}>{t.tool}</p>
              <h2 id="home-calculator-title">{t.calculator}</h2>
              <p>{t.calculatorBody}</p>
            </div>
            <DestinationCalculatorLink className={styles.calculateButton}>
              <Icon name="calculator" size={16} />
              {t.calculate}
            </DestinationCalculatorLink>
            <ul className={styles.countries}>
              {t.countries.map((country) => (
                <li key={country.slug}>
                  <Link href={`/${locale}/calculator/${country.slug}/`}>
                    <CountryFlag countryCode={country.countryCode} />
                    <span>{country.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className={styles.cta} aria-labelledby="home-enquiry-title" data-home-section="cta">
        <div className={styles.ctaContent}>
          <h2 id="home-enquiry-title">{t.ready}</h2>
          <p>{t.readyBody}</p>
          <a
            className={styles.contactButton}
            href={siteConfig.contacts.whatsapp.href}
            data-analytics-contact="whatsapp"
            target="_blank"
            rel="noopener noreferrer"
          >
            <SocialIcon platform="whatsapp" size={19} />
            {contacts('title')}
            <Icon name="arrow" size={18} />
          </a>
        </div>
      </section>
    </div>
  );
}
