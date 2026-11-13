'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/routing';
import type { ManufactureRangeCalculation, ManufactureQuoteScenario } from '../application/manufacture-range';
import { manufactureRangeCopy } from '../application/manufacture-range-copy';
import { convertImportAmountToUsd } from '../application/display-currency';
import type { ExchangeRateSnapshot } from '../infrastructure/exchange-rates';
import { FeeLine } from './fee-line';
import styles from './manufacture-range-result.module.css';

export function ManufactureRangeResult({ calculation, locale, rates }: {
  calculation: ManufactureRangeCalculation;
  locale: Locale;
  rates: ExchangeRateSnapshot;
}) {
  const copy = manufactureRangeCopy[locale];
  const t = useTranslations('Calculator');
  const tf = useTranslations('Fees');
  const ta = useTranslations('Assumptions');
  const td = useTranslations('FeeDisplay');
  const prefix = useId();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const formatter = new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : locale, { maximumFractionDigits: 2 });
  const separator = formatter.formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.';
  const format = (value: string) => {
    const match = /^(-?\d+)(?:\.(\d+))?$/.exec(value);
    return match ? `${formatter.format(BigInt(match[1]))}${match[2] ? separator + match[2] : ''}` : '—';
  };
  const usd = (scenario: ManufactureQuoteScenario, value: string) => {
    const converted = convertImportAmountToUsd(value, scenario.input, rates);
    return converted === null ? '— USD' : `≈ ${format(converted)} USD`;
  };
  if (!calculation.minimum || !calculation.maximum) return <p className={styles.notice} role="status" data-manufacture-range-unavailable>{copy.unavailable}</p>;
  const minimum = calculation.minimum;
  const maximum = calculation.maximum;
  const source = copy.source.replace('{from}', calculation.range.from).replace('{to}', calculation.range.to)
    .replace('{count}', calculation.evaluatedMonths.toLocaleString(locale));
  function scenarioDetails(scenario: ManufactureQuoteScenario, bound: 'minimum' | 'maximum') {
    const { result } = scenario;
    const feeId = (line: typeof result.lines[number], additional = false) => `${prefix}-${bound}-${scenario.manufactureDate}-${additional ? 'extra-' : ''}${line.id}`;
    const allIds = [...result.lines.map(line => feeId(line)), ...result.additionalCosts.map(line => feeId(line, true))];
    const allExpanded = allIds.length > 0 && allIds.every(id => expanded.has(id));
    const renderFee = (line: typeof result.lines[number], additional = false) => {
      const id = feeId(line, additional);
      return <FeeLine key={id} line={line} label={tf(line.id)} amount={format(line.amount)} usd={usd(scenario, line.amount)}
        currency={result.currency} detailsId={id} expanded={expanded.has(id)} additional={additional}
        onToggle={() => setExpanded(previous => {
          const next = new Set(previous);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        })} />;
    };
    return <details key={bound} className={styles.scenario} data-range-scenario={bound}>
      <summary><span>{copy[bound]}</span><strong>{format(result.total!)} {result.currency}</strong><small>{copy.month}: {scenario.manufactureDate}</small></summary>
      <button type="button" className={styles.expandAll} aria-expanded={allExpanded} aria-controls={allIds.join(' ')}
        onClick={() => setExpanded(previous => {
          const next = new Set(previous);
          for (const id of allIds) if (allExpanded) next.delete(id); else next.add(id);
          return next;
        })}>{td(allExpanded ? 'collapseAll' : 'expandAll')}</button>
      {result.lines.map(line => renderFee(line))}
      {result.additionalCosts.length > 0 && <><h4>{t('additionalCostsTitle')}</h4>{result.additionalCosts.map(line => renderFee(line, true))}</>}
      {result.assumptions.length > 0 && <ul>{result.assumptions.map(key => <li key={key}>{ta(key)}</li>)}</ul>}
    </details>;
  }
  return <section className={styles.range} data-testid="manufacture-range-result">
    <p className={styles.note}>{source}</p>
    <div className={styles.total}>
      <span>{t('importTotal')}</span>
      <strong data-testid="manufacture-range-total">{format(minimum.result.total!)} – {format(maximum.result.total!)} {minimum.result.currency}</strong>
      <span>{usd(minimum, minimum.result.total!)} – {usd(maximum, maximum.result.total!)}</span>
      <small>{t('notLanded')}</small>
    </div>
    <p className={styles.note}>{copy.sameInputs}</p>
    {scenarioDetails(minimum, 'minimum')}{scenarioDetails(maximum, 'maximum')}
    <p className={styles.note}>{t('simpleReferenceNotice')}</p>
  </section>;
}
