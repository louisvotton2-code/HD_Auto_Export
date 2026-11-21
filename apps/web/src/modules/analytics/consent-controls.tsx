'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import {
  acceptPrivacyNotice, declineTrackingConsent, getTrackingConsent, subscribeTrackingConsent,
} from '@/shared/lib/tracking-consent';
import styles from './consent-controls.module.css';

const labels = {
  zh: {
    bannerTitle: 'Cookie 与隐私说明',
    notice: '我们使用 Cookie 进行分析并改善您的体验。',
    metaNotice: '我们使用 Cookie 进行分析并改善您的体验，部分车辆详情页也会使用 Facebook Pixel。',
    accept: '接受',
    learnMore: '了解更多',
    policy: '隐私说明',
    decline: '不启用会话分析',
    withdraw: '撤回会话分析同意',
    stopped: '本站会话分析已关闭。',
    declineCombined: '不启用分析与 Facebook Pixel',
    withdrawCombined: '撤回分析与 Facebook Pixel 同意',
    stoppedCombined: '分析和 Facebook Pixel 已关闭。',
  },
  en: {
    bannerTitle: 'Cookies and privacy',
    notice: 'We use cookies for analytics and to improve your experience.',
    metaNotice: 'We use cookies for analytics and to improve your experience. Selected vehicle pages also use Facebook Pixel.',
    accept: 'Accept',
    learnMore: 'Learn more',
    policy: 'Privacy notice',
    decline: 'Decline session analytics',
    withdraw: 'Withdraw consent for session analytics',
    stopped: 'Session analytics is off.',
    declineCombined: 'Decline analytics and Facebook Pixel',
    withdrawCombined: 'Withdraw consent for analytics and Facebook Pixel',
    stoppedCombined: 'Analytics and Facebook Pixel are off.',
  },
  ru: {
    bannerTitle: 'Cookie и конфиденциальность',
    notice: 'Мы используем файлы cookie для аналитики и улучшения вашего опыта.',
    metaNotice: 'Мы используем файлы cookie для аналитики и улучшения вашего опыта. На отдельных страницах автомобилей используется Facebook Pixel.',
    accept: 'Принять',
    learnMore: 'Подробнее',
    policy: 'Конфиденциальность',
    decline: 'Отказаться от аналитики сессий',
    withdraw: 'Отозвать согласие на аналитику сессий',
    stopped: 'Аналитика сессий отключена.',
    declineCombined: 'Отказаться от аналитики и Facebook Pixel',
    withdrawCombined: 'Отозвать согласие на аналитику и Facebook Pixel',
    stoppedCombined: 'Аналитика и Facebook Pixel отключены.',
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
  const canDecide = (sessionAnalyticsEnabled && !consent.decided) || (metaEnabled && !consent.advertisingDecided);
  if (!hasConsent && !canDecide) {
    return <p className={styles.withdrawalStatus} role="status" data-testid="privacy-analytics-off">
      {offersMeta ? copy.stoppedCombined : copy.stopped}
    </p>;
  }
  const buttonLabel = offersMeta
    ? (hasConsent ? copy.withdrawCombined : copy.declineCombined)
    : (hasConsent ? copy.withdraw : copy.decline);
  return (
    <button
      type="button"
      className={`${styles.preferenceLink} ${styles.withdrawal}`}
      data-testid="privacy-analytics-withdraw"
      onClick={declineTrackingConsent}
    >
      {buttonLabel}
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
              {metaEnabled ? copy.metaNotice : copy.notice}{' '}
              <Link href="/privacy/" locale={locale} prefetch={false} className={styles.learnMore}>{copy.learnMore}</Link>
            </p>
            <button type="button" className={styles.accept} onClick={() => acceptPrivacyNotice(sessionAnalyticsEnabled, metaEnabled)}>
              {copy.accept}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
