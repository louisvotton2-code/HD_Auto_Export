'use client';

import { useTranslations } from 'next-intl';
import { Icon } from '@/shared/ui/icon';
import type { CalculationLine } from '../core/types';
import { FeeMethod } from './fee-method';

export function FeeLine({
  line,
  label,
  amount,
  usd,
  currency,
  detailsId,
  expanded,
  onToggle,
  additional = false,
}: {
  line: CalculationLine;
  label: string;
  amount: string;
  usd: string;
  currency: string;
  detailsId: string;
  expanded: boolean;
  onToggle: () => void;
  additional?: boolean;
}) {
  const t = useTranslations('FeeDisplay');
  const action = t(expanded ? 'hideDetails' : 'showDetails');
  return (
    <div className="fee-line" data-extra-cost={additional ? line.id : undefined}>
      <button
        type="button"
        className="fee-detail-toggle"
        data-testid="fee-detail-toggle"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span className="fee-detail-heading">
          <span>{label}</span>
          <span className="fee-detail-hint">
            {action}
            <Icon name="chevron" size={12} />
          </span>
        </span>
        <span className="fee-values">
          <strong>
            {amount} <small>{currency}</small>
          </strong>
          <span className="fee-usd" data-testid="fee-usd">
            {usd}
          </span>
        </span>
      </button>
      <div
        className="fee-method-panel"
        id={detailsId}
        hidden={!expanded}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <FeeMethod line={line} currency={currency} />
      </div>
    </div>
  );
}
