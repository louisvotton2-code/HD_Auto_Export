'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/i18n/routing';
import { useDestinationCountry } from '@/shared/ui/use-destination-country';
import { DestinationCountryUrlObserver } from '@/shared/ui/destination-country-url-observer';
import { destinationCalculatorPath } from '@/shared/lib/destination-country';
import type { DestinationCountryCode } from '@/shared/lib/destination-country';
import { Icon } from '@/shared/ui/icon';
import { countries } from '../config/countries';
import styles from './destination-calculator-entry.module.css';

const pending = { zh: '正在打开费用计算器', en: 'Opening the import calculator', ru: 'Открываем калькулятор ввоза' } as const;
export function DestinationCalculatorEntry({ locale, countryNames }: { locale: Locale; countryNames: Record<DestinationCountryCode, string> }) {
  const preference = useDestinationCountry();
  const router = useRouter();
  useEffect(() => {
    if (preference.ready) router.replace(`/${locale}${destinationCalculatorPath(preference.country)}`);
  }, [locale, preference.country, preference.ready, router]);
  return <main id="main" className="shell" style={{ minHeight: '45vh', paddingBlock: '4rem' }}>
    <DestinationCountryUrlObserver />
    <p className={styles.status} role="status"><Icon name="loader" size={18} /> {pending[locale]}</p>
    <noscript><nav>{countries.map(country => <p key={country.code}><a href={`/${locale}${destinationCalculatorPath(country.code)}`}>{countryNames[country.code]}</a></p>)}</nav></noscript>
  </main>;
}
