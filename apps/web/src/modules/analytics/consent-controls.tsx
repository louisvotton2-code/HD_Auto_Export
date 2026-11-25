'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import {
  getTrackingConsent,
  saveTrackingConsent,
  subscribeTrackingConsent,
} from '@/shared/lib/tracking-consent';
import styles from './consent-controls.module.css';

const labels = {
  zh: {
    bannerTitle: 'Cookie 与隐私说明',
    notice: '我们使用 Cookie 进行网站分析和衡量广告效果。',
    accept: '接受',
    refuse: '拒绝',
    learnMore: '了解更多',
    policy: '隐私说明',
    decline: '不启用统计',
    withdraw: '撤回统计同意',
    stopped: '站内统计和广告衡量已关闭。',
  },
  en: {
    bannerTitle: 'Cookies and privacy',
    notice: 'We use cookies for site analytics and to measure ad performance.',
    accept: 'Accept',
    refuse: 'Decline',
    learnMore: 'Learn more',
    policy: 'Privacy notice',
    decline: 'Decline tracking',
    withdraw: 'Withdraw consent for tracking',
    stopped: 'Site analytics and ad measurement are off.',
  },
  ru: {
    bannerTitle: 'Cookie и конфиденциальность',
    notice: 'Мы используем cookie для аналитики сайта и оценки эффективности рекламы.',
    accept: 'Принять',
    refuse: 'Отклонить',
    learnMore: 'Подробнее',
    policy: 'Конфиденциальность',
    decline: 'Отклонить отслеживание',
    withdraw: 'Отозвать согласие на отслеживание',
    stopped: 'Аналитика сайта и оценка рекламы отключены.',
  },
} satisfies Record<Locale, Record<string, string>>;

function usePublicConsent() {
  return useSyncExternalStore(
    subscribeTrackingConsent,
    () => (window.parent === window ? getTrackingConsent() : null),
    () => null,
  );
}

export function PrivacyAnalyticsWithdrawal({ locale }: { locale: Locale }) {
  const consent = usePublicConsent();
  const copy = labels[locale];
  if (!consent) return null;
  if (consent === 'declined') {
    return (
      <p className={styles.withdrawalStatus} role="status" data-testid="privacy-analytics-off">
        {copy.stopped}
      </p>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.preferenceLink} ${styles.withdrawal}`}
      data-testid="privacy-analytics-withdraw"
      onClick={() => saveTrackingConsent(false)}
    >
      {consent === 'accepted' ? copy.withdraw : copy.decline}
    </button>
  );
}

export function TrackingConsentControls({ locale }: { locale: Locale }) {
  const consent = usePublicConsent();
  const banner = useRef<HTMLElement>(null);
  const copy = labels[locale];
  const showBanner = consent === 'pending';

  useEffect(() => {
    const element = banner.current;
    if (!showBanner || !element) return;
    const style = document.documentElement.style;
    const measure = () => {
      style.setProperty(
        '--privacy-bar-offset',
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      );
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
        <Link href="/privacy/" locale={locale} prefetch={false} className={styles.preferenceLink}>
          {copy.policy}
        </Link>
      </div>
      {showBanner && (
        <section
          ref={banner}
          className={styles.banner}
          aria-label={copy.bannerTitle}
          data-testid="tracking-consent-banner"
        >
          <div className={styles.bannerInner}>
            <p className={styles.bannerCopy}>
              {copy.notice}{' '}
              <Link href="/privacy/" locale={locale} prefetch={false} className={styles.learnMore}>
                {copy.learnMore}
              </Link>
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.accept}
                onClick={() => saveTrackingConsent(true)}
              >
                {copy.accept}
              </button>
              <button
                type="button"
                className={styles.accept}
                onClick={() => saveTrackingConsent(false)}
              >
                {copy.refuse}
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
