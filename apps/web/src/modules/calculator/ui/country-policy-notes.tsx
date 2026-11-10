'use client';

import { useTranslations } from 'next-intl';
import { Icon } from '@/shared/ui/icon';
import type { CalculationInput } from '../core/types';
import { getCountryReferenceNotes, getCountryReferenceUrl } from '../application/reference-notes';

export function CountryPolicyNotes({ input }: { input: CalculationInput }) {
  const t = useTranslations('CountryPolicies');
  const tc = useTranslations('Countries');
  return (
    <section
      className="country-policy-notes"
      data-testid="country-policy-notes"
      aria-labelledby="policy-notes-title"
    >
      <h3 id="policy-notes-title">
        <Icon name="info" size={14} />
        {t('title', { country: tc(input.country) })}
      </h3>
      <ul>
        {getCountryReferenceNotes(input).map((key) => (
          <li key={key} data-policy-note={key}>
            {t(key)}
          </li>
        ))}
      </ul>
      <p className="policy-reference-hint">{t('referenceHint')}</p>
      <a href={getCountryReferenceUrl(input.country)} target="_blank" rel="noreferrer">
        {t('source', { date: '2026-10-23' })}
        <Icon name="diagonal" size={11} />
      </a>
    </section>
  );
}
