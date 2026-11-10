'use client';

import { useTranslations } from 'next-intl';
import type { CalculationInput, CalculationResult } from '../core/types';
import { getResultStamp, type StampText } from '../application/result-stamp';
import './result-stamp.css';

/** A changing reference receipt mark, not an approval or customs certification. */
export function ResultStamp({
  input,
  result,
}: {
  input: CalculationInput;
  result: CalculationResult;
}) {
  const t = useTranslations('ResultStamp');
  const tc = useTranslations('Countries');
  const stamp = getResultStamp(input, result);
  const renderText = (value: StampText) => t(value.key, value.params);
  const title = renderText(stamp.title);
  const subtitle = renderText(stamp.subtitle);
  const condition = stamp.condition ? renderText(stamp.condition) : '';
  const reference = stamp.year ? t('reference', { year: stamp.year }) : t('pendingFooter');
  return (
    <div
      className={`hd-result-stamp hd-result-stamp--${stamp.tone}`}
      role="img"
      aria-label={t('accessible', {
        country: tc(stamp.country),
        title,
        subtitle,
        condition,
        reference,
      })}
      data-testid="result-stamp"
      data-stamp-title={stamp.title.key}
      data-stamp-band={stamp.subtitle.key}
      data-stamp-condition={stamp.condition?.key ?? ''}
      data-stamp-tone={stamp.tone}
    >
      <div className="hd-result-stamp__content" aria-hidden="true">
        <span className="hd-result-stamp__country">{tc(stamp.country)}</span>
        <strong className="hd-result-stamp__title">{title}</strong>
        <span className="hd-result-stamp__band">{subtitle}</span>
        {condition && <span className="hd-result-stamp__condition">{condition}</span>}
        <span className="hd-result-stamp__reference">{reference}</span>
      </div>
    </div>
  );
}
