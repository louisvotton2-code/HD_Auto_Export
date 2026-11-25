'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import {
  acceptPrivacyNotice, declineTrackingConsent, getTrackingConsent, saveTrackingPreferences, subscribeTrackingConsent,
} from '@/shared/lib/tracking-consent';
import styles from './consent-controls.module.css';

const labels = {
  zh: {
    bannerTitle: 'Cookie 与隐私说明',
    notice: '我们使用 Cookie 进行分析并改善您的体验。',
    metaNotice: '在推广车辆页面，Facebook Pixel 会向 Meta 发送车辆浏览和联系按钮点击信息，用于衡量和优化广告。',
    accept: '接受',
    refuse: '拒绝',
    choose: '选择用途',
    analyticsOnly: '仅站内分析',
    adsOnly: '仅广告衡量',
    learnMore: '了解更多',
    policy: '隐私说明',
    decline: '不启用会话分析',
    withdraw: '撤回会话分析同意',
    stopped: '本站会话分析已关闭。',
    declineCombined: '不启用分析与 Facebook Pixel',
    withdrawCombined: '撤回分析与 Facebook Pixel 同意',
    stoppedCombined: '分析和 Facebook Pixel 已关闭。',
    declineMeta: '不启用广告衡量',
    withdrawMeta: '撤回广告衡量同意',
    stoppedMeta: '广告衡量已关闭。',
  },
  en: {
    bannerTitle: 'Cookies and privacy',
    notice: 'We use cookies for analytics and to improve your experience.',
    metaNotice: 'On promoted vehicle pages, Facebook Pixel shares vehicle views and contact button clicks with Meta to measure and improve our ads.',
    accept: 'Accept',
    refuse: 'Decline',
    choose: 'Choose purposes',
    analyticsOnly: 'Site analytics only',
    adsOnly: 'Ad measurement only',
    learnMore: 'Learn more',
    policy: 'Privacy notice',
    decline: 'Decline session analytics',
    withdraw: 'Withdraw consent for session analytics',
    stopped: 'Session analytics is off.',
    declineCombined: 'Decline analytics and Facebook Pixel',
    withdrawCombined: 'Withdraw consent for analytics and Facebook Pixel',
    stoppedCombined: 'Analytics and Facebook Pixel are off.',
    declineMeta: 'Decline ad measurement',
    withdrawMeta: 'Withdraw consent for ad measurement',
    stoppedMeta: 'Ad measurement is off.',
  },
  ru: {
    bannerTitle: 'Cookie и конфиденциальность',
    notice: 'Мы используем файлы cookie для аналитики и улучшения вашего опыта.',
    metaNotice: 'На страницах рекламируемых автомобилей Facebook Pixel передаёт Meta сведения о просмотрах и нажатиях на кнопки связи, чтобы мы могли оценивать и улучшать рекламу.',
    accept: 'Принять',
    refuse: 'Отклонить',
    choose: 'Выбрать цели',
    analyticsOnly: 'Только аналитика сайта',
    adsOnly: 'Только оценка рекламы',
    learnMore: 'Подробнее',
    policy: 'Конфиденциальность',
    decline: 'Отказаться от аналитики сессий',
    withdraw: 'Отозвать согласие на аналитику сессий',
    stopped: 'Аналитика сессий отключена.',
    declineCombined: 'Отказаться от аналитики и Facebook Pixel',
    withdrawCombined: 'Отозвать согласие на аналитику и Facebook Pixel',
    stoppedCombined: 'Аналитика и Facebook Pixel отключены.',
    declineMeta: 'Отказаться от оценки рекламы',
    withdrawMeta: 'Отозвать согласие на оценку рекламы',
    stoppedMeta: 'Оценка эффективности рекламы отключена.',
  },
} satisfies Record<Locale, Record<string, string>>;

function usePublicConsent() {
  return useSyncExternalStore(
    subscribeTrackingConsent,
    () => window.parent === window ? getTrackingConsent() : null,
    () => null,
  );
}

type ConsentControlProps = {
  locale: Locale;
  sessionAnalyticsEnabled: boolean;
  metaEnabled: boolean;
};

export function PrivacyAnalyticsWithdrawal({ locale, sessionAnalyticsEnabled, metaEnabled }: ConsentControlProps) {
  const consent = usePublicConsent();
  const copy = labels[locale];
  if (!consent) return null;
  const hasConsent = consent.analytics || consent.advertising;
  const offersMeta = metaEnabled || consent.advertising;
  const offersAnalytics = sessionAnalyticsEnabled || consent.analytics;
  const canDecide = (sessionAnalyticsEnabled && !consent.decided) || (metaEnabled && !consent.advertisingDecided);
  if (!hasConsent && !canDecide) {
    return <p className={styles.withdrawalStatus} role="status" data-testid="privacy-analytics-off">
      {offersMeta ? (offersAnalytics ? copy.stoppedCombined : copy.stoppedMeta) : copy.stopped}
    </p>;
  }
  const withdraw = offersMeta ? (offersAnalytics ? copy.withdrawCombined : copy.withdrawMeta) : copy.withdraw;
  const decline = offersMeta ? (offersAnalytics ? copy.declineCombined : copy.declineMeta) : copy.decline;
  return (
    <button
      type="button"
      className={`${styles.preferenceLink} ${styles.withdrawal}`}
      data-testid="privacy-analytics-withdraw"
      onClick={() => declineTrackingConsent(offersAnalytics, offersMeta)}
    >
      {hasConsent ? withdraw : decline}
    </button>
  );
}

export function TrackingConsentControls({ locale, sessionAnalyticsEnabled, metaEnabled }: ConsentControlProps) {
  const consent = usePublicConsent();
  const banner = useRef<HTMLElement>(null);
  const copy = labels[locale];
  const showBanner = consent !== null && (
    (sessionAnalyticsEnabled ? !consent.decided : !consent.acknowledged) || (metaEnabled && !consent.advertisingDecided)
  );
  const askAnalytics = sessionAnalyticsEnabled && !consent?.decided;
  const askAdvertising = metaEnabled && !consent?.advertisingDecided;
  const notice = askAdvertising ? [askAnalytics && copy.notice, copy.metaNotice].filter(Boolean).join(' ') : copy.notice;

  useEffect(() => {
    const element = banner.current;
    if (!showBanner || !element) return;
    const style = document.documentElement.style;
    const measure = () => {
      style.setProperty('--privacy-bar-offset', `${Math.ceil(element.getBoundingClientRect().height)}px`);
    };
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(element);
    return () => {
      observer.disconnect();
      style.removeProperty('--privacy-bar-offset');
    };
  }, [showBanner]);

  return (
    <>
      <div className={styles.footerControl}>
        <Link href="/privacy/" locale={locale} prefetch={false} className={styles.preferenceLink}>{copy.policy}</Link>
      </div>
      {showBanner && (
        <section ref={banner} className={styles.banner} aria-label={copy.bannerTitle} data-testid="tracking-consent-banner">
          <div className={styles.bannerInner}>
            <p className={styles.bannerCopy}>
              {notice}{' '}
              <Link href="/privacy/" locale={locale} prefetch={false} className={styles.learnMore}>{copy.learnMore}</Link>
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.accept} onClick={() => acceptPrivacyNotice(askAnalytics, askAdvertising)}>
                {copy.accept}
              </button>
              {metaEnabled && (
                <button type="button" className={styles.accept} onClick={() => declineTrackingConsent(askAnalytics, askAdvertising)}>
                  {copy.refuse}
                </button>
              )}
            </div>
            {askAnalytics && askAdvertising && (
              <details className={styles.purposes}>
                <summary>{copy.choose}</summary>
                <div className={styles.scopeChoices}>
                  <button type="button" className={styles.accept} onClick={() => saveTrackingPreferences({ analytics: true, advertising: false })}>
                    {copy.analyticsOnly}
                  </button>
                  <button type="button" className={styles.accept} onClick={() => saveTrackingPreferences({ analytics: false, advertising: true })}>
                    {copy.adsOnly}
                  </button>
                </div>
              </details>
            )}
          </div>
        </section>
      )}
    </>
  );
}
