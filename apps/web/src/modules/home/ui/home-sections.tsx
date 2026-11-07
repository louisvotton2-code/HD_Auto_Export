'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { Icon } from '@/shared/ui/icon';
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

function DemoChat({
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
        <span className={styles.chatBack} aria-hidden="true">
          ‹
        </span>
        <span className={styles.chatAvatar} aria-hidden="true">
          HD
        </span>
        <span className={styles.chatIdentity}>
          <strong>HD Auto Export</strong>
          <small>{t.chatContact}</small>
        </span>
        <span aria-hidden="true">⋮</span>
      </span>
      <span className={styles.chatBody}>
        <span className={styles.chatDate}>{t.chatToday}</span>
        <span className={styles.chatDisclaimer}>{t.chatDemo}</span>
        {chat.messages.map((message, messageIndex) => (
          <span className={styles.chatBubble} data-company={message.fromCompany} key={messageIndex}>
            <span>{message.text}</span>
            <small>
              10:{String(10 + messageIndex * 2).padStart(2, '0')}
              {message.fromCompany ? ' ✓✓' : ''}
            </small>
          </span>
        ))}
        <span className={styles.chatDemoFooter}>{t.chatDemo}</span>
      </span>
      <span className={styles.chatComposer} aria-hidden="true">
        <span>＋</span>
        <i />
        <span>◉</span>
      </span>
    </span>
  );
}

/** Reference-layout sections. The route supplies model data through the vehicle module. */
export function HomeSections({
  locale,
  models,
  paused: globallyPaused = false,
}: {
  locale: Locale;
  models: HomeModel[];
  paused?: boolean;
}) {
  const t = sectionContent[locale];
  const modelsRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeModel, setActiveModel] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [selectedChat, setSelectedChat] = useState(0);
  const [showFormNotice, setShowFormNotice] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const goToModel = (index: number, manual = true) => {
    const track = modelsRef.current;
    const item = track?.children[index] as HTMLElement | undefined;
    if (!track || !item) return;
    if (manual) setPaused(true);
    setActiveModel(index);
    track.scrollTo({
      left: item.offsetLeft - track.offsetLeft,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  };

  useEffect(() => {
    const track = modelsRef.current;
    if (!track || globallyPaused || paused || interacting || reducedMotion || models.length < 2)
      return;
    const timer = window.setInterval(() => {
      const rect = track.getBoundingClientRect();
      if (document.hidden || rect.bottom < 0 || rect.top > window.innerHeight) return;
      const index = (activeModel + 1) % models.length;
      const item = track.children[index] as HTMLElement | undefined;
      if (item) {
        setActiveModel(index);
        track.scrollTo({ left: item.offsetLeft - track.offsetLeft, behavior: 'smooth' });
      }
    }, 3500);
    return () => window.clearInterval(timer);
  }, [activeModel, globallyPaused, paused, interacting, reducedMotion, models.length]);

  return (
    <div className={styles.sections}>
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
              {t.catalog}
            </Link>
          </div>
          <div
            ref={modelsRef}
            className={styles.modelsTrack}
            aria-label={t.popular}
            tabIndex={0}
            onScroll={(event) => {
              const node = event.currentTarget;
              const child = node.firstElementChild;
              if (child)
                setActiveModel(
                  Math.round(node.scrollLeft / (child.getBoundingClientRect().width + 20)),
                );
            }}
            onMouseEnter={() => setInteracting(true)}
            onMouseLeave={() => setInteracting(false)}
            onFocus={() => setInteracting(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false);
            }}
            onTouchStart={() => setPaused(true)}
            onWheel={() => setPaused(true)}
            onKeyDown={() => setPaused(true)}
          >
            {models.map((model, index) => (
              <Link
                className={styles.modelCard}
                href={model.href}
                key={`${model.brand}-${model.name}-${index}`}
              >
                <span className={styles.modelPhoto}>
                  <img src={model.image} alt={`${model.brand} ${model.name}`} loading="lazy" />
                </span>
                <span className={styles.modelBody}>
                  <span className={styles.modelBrand}>{model.brand}</span>
                  <strong className={styles.modelName}>{model.name}</strong>
                  <span className={styles.modelSubtitle}>{model.subtitle || t.demo}</span>
                  <span className={styles.modelBottom}>
                    <span>
                      <small>{model.priceUsd ? t.price : t.demo}</small>
                      <strong>
                        {model.priceUsd
                          ? `$${new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : locale === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 0 }).format(model.priceUsd)}`
                          : 'HD Auto Export'}
                      </strong>
                    </span>
                    <span className={styles.modelMore}>{t.learn}</span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
          <div className={styles.pagination}>
            <button
              type="button"
              className={styles.modelPrevious}
              aria-label={t.previous}
              onClick={() => goToModel((activeModel - 1 + models.length) % models.length)}
            >
              ‹
            </button>
            <div className={styles.dots}>
              {models.map((model, index) => (
                <button
                  key={`${model.name}-${index}`}
                  className={styles.dot}
                  data-active={activeModel === index}
                  aria-label={`${t.slide} ${index + 1}`}
                  aria-current={activeModel === index ? 'true' : undefined}
                  onClick={() => goToModel(index)}
                />
              ))}
            </div>
            <button
              type="button"
              className={styles.modelNext}
              aria-label={t.next}
              onClick={() => goToModel((activeModel + 1) % models.length)}
            >
              ›
            </button>
          </div>
          <button
            type="button"
            className={styles.pause}
            disabled={reducedMotion}
            onClick={() => setPaused(!paused)}
            aria-label={paused ? t.play : t.pause}
          >
            {paused ? '▶' : 'Ⅱ'}
            <span>{paused ? t.play : t.pause}</span>
          </button>
          <Link className={styles.mobileCatalog} href={`/${locale}/cars/`}>
            {t.catalog}
          </Link>
        </div>
      </section>

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
                  <DemoChat locale={locale} index={index} />
                  <span className={styles.enlarge} aria-hidden="true">
                    ⤢
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
          aria-labelledby="demo-chat-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) dialogRef.current?.close();
          }}
        >
          <div className={styles.dialogToolbar}>
            <h3 id="demo-chat-title">{t.chats[selectedChat].title}</h3>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label={t.close}>
              ×
            </button>
          </div>
          <DemoChat locale={locale} index={selectedChat} expanded />
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
              <div className={styles.countries}>
                {t.countries.map((country) => (
                  <Link href={`/${locale}/calculator/${country.slug}/`} key={country.slug}>
                    {country.flag} {country.name}
                  </Link>
                ))}
              </div>
            </div>
            <Link className={styles.calculateButton} href={`/${locale}/calculator/russia/`}>
              <Icon name="calculator" size={16} />
              {t.calculate}
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.cta} aria-labelledby="home-enquiry-title" data-home-section="cta">
        <div className={styles.ctaContent}>
          <h2 id="home-enquiry-title">{t.ready}</h2>
          <p>{t.readyBody}</p>
          <form
            className={styles.enquiryForm}
            onSubmit={(event) => {
              event.preventDefault();
              setShowFormNotice(true);
            }}
          >
            <label className={styles.srOnly} htmlFor="home-phone">
              {t.phone}
            </label>
            <input
              id="home-phone"
              type="tel"
              name="phone"
              placeholder="+1 (999) 999-9999"
              autoComplete="tel"
              maxLength={32}
              pattern="[+0-9 ()-]{6,32}"
              onChange={() => setShowFormNotice(false)}
              required
              aria-describedby="home-form-hint"
            />
            <button type="submit">
              {t.send}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <small className={styles.formHint} id="home-form-hint">
            {t.formHint}
          </small>
          {showFormNotice && (
            <div className={styles.formNotice} role="status">
              <p>{t.formNotice}</p>
              <a href={siteConfig.contacts.whatsapp.href} target="_blank" rel="noopener noreferrer">
                {t.whatsapp} ↗
              </a>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
