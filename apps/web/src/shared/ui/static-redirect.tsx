'use client';

import { useEffect } from 'react';
import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';

const calculatorLabels = {
  zh: { opening: '正在打开计算器…', link: '前往计算器' },
  en: { opening: 'Opening the calculator…', link: 'Open calculator' },
  ru: { opening: 'Открываем калькулятор…', link: 'Перейти к калькулятору' },
} as const;

const homeLabels = {
  zh: { opening: '正在打开首页…', link: '前往首页' },
  en: { opening: 'Opening the home page…', link: 'Open home page' },
  ru: { opening: 'Открываем главную страницу…', link: 'На главную' },
} as const;

/** A static entry page: navigation needs no server and the link also works without JavaScript. */
export function StaticRedirect({
  href,
  locale,
  destination = 'calculator',
}: {
  href: string;
  locale: Locale;
  destination?: 'calculator' | 'home';
}) {
  const labels = destination === 'home' ? homeLabels : calculatorLabels;
  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <main id="main" className="not-found">
      <span className="eyebrow">{siteConfig.name}</span>
      <h1>{labels[locale].opening}</h1>
      <a className="primary-button" href={href}>
        {labels[locale].link}
      </a>
    </main>
  );
}
