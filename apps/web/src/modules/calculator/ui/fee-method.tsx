'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { CalculationLine } from '../core/types';
import { formatFeeFormula, formatMethodParameters } from '../application/fee-presentation';

export function FeeMethod({ line, currency }: { line: CalculationLine; currency: string }) {
  const locale = useLocale();
  const t = useTranslations('FeeMethods');
  const td = useTranslations('FeeDisplay');
  return (
    <div className="fee-method-block" data-testid="fee-method" data-method-key={line.method?.key}>
      <p className="fee-method-description">
        {line.method
          ? t(line.method.key, formatMethodParameters(line.method.params, locale))
          : td('fallback')}
      </p>
      <div className="fee-formula" data-testid="fee-formula">
        <span>{td('formula')}</span>
        <code>
          {formatFeeFormula(line, currency, locale, {
            maximum: td('maximum'),
            lookup: td('lookup'),
            amount: td('amount'),
          })}
        </code>
      </div>
    </div>
  );
}
