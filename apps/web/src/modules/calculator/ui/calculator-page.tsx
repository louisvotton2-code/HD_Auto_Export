'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { NavigationLink as Link } from '@/shared/ui/navigation-link';
import { siteConfig } from '@/shared/config/site';
import { Icon } from '@/shared/ui/icon';
import { useValueHighlight } from '@/shared/ui/interaction-motion';
import { countries, type CountryRecord } from '../config/countries';
import { calculateImportEstimate, type CalculationInput, type Powertrain } from '../index';
import { createDefaultInput, convertTransactionPrice } from '../application/defaults';
import { getClearanceDate } from '../application/current-date';
import {
  CALCULATOR_DRAFT_STORAGE_KEY,
  CALCULATOR_POWERTRAINS,
  LEGACY_CALCULATOR_DRAFT_STORAGE_KEY,
  restoreCalculatorDraft,
  type StoredCalculatorDraft,
} from '../application/draft';
import { convertImportAmountToUsd } from '../application/display-currency';
import { normalizePageInput } from '../application/page-input';
import { getCopyQuoteFacts, type CopyQuoteText } from '../application/copy-quote';
import { CountryPolicyNotes } from './country-policy-notes';
import { FeeLine } from './fee-line';
import { ResultStamp } from './result-stamp';
import { formatFeeFormula, formatMethodParameters } from '../application/fee-presentation';
import type { CalculationLine } from '../core/types';
import {
  deriveRates,
  EXCHANGE_RATE_ATTRIBUTION,
  type ExchangeRateSnapshot,
} from '../infrastructure/exchange-rates';

type InputField =
  | 'price'
  | 'displacementCc'
  | 'powerHp'
  | 'manufactureDate'
  | 'customsDate'
  | 'freight'
  | 'insurance'
  | 'transactionRate'
  | 'euroRate'
  | 'usdRate';

function defaultInput(
  country: CountryRecord,
  date: string,
  rates: ExchangeRateSnapshot,
): CalculationInput {
  return createDefaultInput(country.code, date, rates);
}

const errorMap: Record<string, string> = {
  invalid_option: 'invalid_number',
  invalid_decimal: 'invalid_number',
  must_be_positive: 'positive_required',
  invalid_month: 'invalid_date',
  invalid_date: 'invalid_date',
  manufacture_after_customs: 'future_manufacture',
};
const reasonMap: Record<string, string> = {
  country_rules_pending: 'country_pending',
  company_rules_pending: 'company_pending',
  powertrain_rules_pending: 'powertrain_pending',
  recycling_rules_pending: 'power_pending',
  rule_date_outside_reference: 'year_pending',
};

export function CalculatorPage({
  country,
  initialDate,
  initialRates,
}: {
  country: CountryRecord;
  initialDate: string;
  initialRates: ExchangeRateSnapshot;
}) {
  const t = useTranslations('Calculator');
  const tc = useTranslations('Countries');
  const tf = useTranslations('Fees');
  const te = useTranslations('Errors');
  const tr = useTranslations('Reasons');
  const ta = useTranslations('Assumptions');
  const tm = useTranslations('FeeMethods');
  const td = useTranslations('FeeDisplay');
  const tq = useTranslations('CopyQuote');
  const locale = useLocale();
  const [input, setInput] = useState(() => defaultInput(country, initialDate, initialRates));
  const [manualRates, setManualRates] = useState(false);
  const [ready, setReady] = useState(false);
  const [advanced, setAdvanced] = useState(true);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [expandedFees, setExpandedFees] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const countryNavRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const raw: StoredCalculatorDraft = { current: null };
    try {
      raw.current = sessionStorage.getItem(CALCULATOR_DRAFT_STORAGE_KEY);
      if (!raw.current) raw.legacy = sessionStorage.getItem(LEGACY_CALCULATOR_DRAFT_STORAGE_KEY);
    } catch {
      /* Optional draft: unavailable storage keeps the current route's defaults. */
    }
    // The exported HTML contains the build date; fresh browser defaults use the visit date.
    // Explicit saved dates remain editable facts and must not be silently overwritten.
    const restored = restoreCalculatorDraft(
      raw,
      country,
      getClearanceDate(new Date()),
      initialRates,
    );
    setInput(restored.input);
    setManualRates(restored.manualRates);
    setTouched(new Set());
    setCopyState('idle');
    setAdvanced(true);
    setExpandedFees(new Set());
    setReady(true);
  }, [country, initialDate, initialRates]);

  useEffect(() => {
    if (!ready || input.country !== country.code) return;
    try {
      sessionStorage.setItem(CALCULATOR_DRAFT_STORAGE_KEY, JSON.stringify({ input, manualRates }));
    } catch {
      /* Optional draft. */
    }
  }, [input, manualRates, ready, country.code]);

  useEffect(() => {
    const nav = countryNavRef.current;
    const active = nav?.querySelector<HTMLElement>('.country-tab.active');
    if (nav && active && nav.scrollWidth > nav.clientWidth)
      nav.scrollLeft =
        active.offsetLeft - nav.offsetLeft - (nav.clientWidth - active.clientWidth) / 2;
  }, [country.code]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => setKeyboardOpen(window.innerHeight - viewport.height > 140);
    viewport.addEventListener('resize', resize);
    return () => viewport.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timeout = window.setTimeout(() => setCopyState('idle'), 3000);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const normalized = useMemo(() => {
    const next = normalizePageInput(input, country);
    for (const key of [
      'price',
      'displacementCc',
      'powerHp',
      'freight',
      'insurance',
      'transactionRate',
      'euroRate',
      'usdRate',
    ] as const)
      next[key] = next[key]?.trim() ?? '';
    return next;
  }, [input, country]);
  const result = useMemo(() => calculateImportEstimate(normalized), [normalized]);
  const totalRef = useValueHighlight(`${result.status}:${result.total}:${result.currency}`);
  const formatter = useMemo(
    () => new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const decimalSeparator =
    formatter.formatToParts(1.1).find((part) => part.type === 'decimal')?.value || '.';
  const format = (amount: string) => {
    const match = /^(-?\d+)(?:\.(\d+))?$/.exec(amount);
    if (!match) return '—';
    const whole = formatter.format(BigInt(match[1]));
    return match[2] ? `${whole}${decimalSeparator}${match[2]}` : whole;
  };
  function usdText(amount: string) {
    const converted = convertImportAmountToUsd(amount, normalized, initialRates);
    if (converted === null) return '— USD';
    const [integer, decimals] = converted.split('.');
    return `≈ ${formatter.format(BigInt(integer))}${decimalSeparator}${decimals.padEnd(2, '0')} USD`;
  }
  const isElectric = input.powertrain === 'bev';
  const needsDisplacement = !isElectric && !(country.code === 'KG' && input.powertrain === 'erev');
  const fuelGroup = isElectric
    ? 'electric'
    : ['hev', 'phev', 'erev'].includes(input.powertrain)
      ? 'hybrid'
      : 'fuel';
  const scopeLabel = country.hasImporterChoice
    ? t(normalized.importerType === 'individual' ? 'personal' : 'company')
    : country.personalReference
      ? t('personal')
      : null;
  const lines = result.lines;
  const feeDetailsId = (line: CalculationLine, additional = false) =>
    `fee-details-${country.code}-${additional ? 'extra' : 'main'}-${line.id}`;
  const visibleFeeIds = [
    ...lines.map((line) => feeDetailsId(line)),
    ...result.additionalCosts.map((line) => feeDetailsId(line, true)),
  ];
  const allFeesExpanded =
    visibleFeeIds.length > 0 && visibleFeeIds.every((id) => expandedFees.has(id));

  function toggleFee(id: string) {
    setExpandedFees((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function update<K extends keyof CalculationInput>(key: K, value: CalculationInput[K]) {
    setInput((previous) => ({
      ...previous,
      [key]: value,
      ...(country.code === 'UZ' && previous.currency === 'USD' && key === 'transactionRate'
        ? { usdRate: value }
        : {}),
    }));
    setCopyState('idle');
    if (key === 'transactionRate' || key === 'euroRate' || key === 'usdRate') setManualRates(true);
  }
  function changeCurrency(currency: 'CNY' | 'USD') {
    setInput((previous) => ({
      ...previous,
      currency,
      price: convertTransactionPrice(previous.price, previous.currency, currency, initialRates),
      freight: convertTransactionPrice(previous.freight, previous.currency, currency, initialRates),
      insurance: convertTransactionPrice(
        previous.insurance,
        previous.currency,
        currency,
        initialRates,
      ),
      ...deriveRates(initialRates, country.code, currency),
    }));
    setManualRates(false);
    setCopyState('idle');
  }
  function reset() {
    setInput(defaultInput(country, getClearanceDate(new Date()), initialRates));
    setManualRates(false);
    setTouched(new Set());
    setCopyState('idle');
    setAdvanced(true);
    setExpandedFees(new Set());
  }
  function feeLabel(id: string) {
    return tf(
      [
        'duty',
        'customsFee',
        'recycling',
        'excise',
        'importTax',
        'vat',
        'registration',
        'plates',
        'relatedCosts',
        'luxuryExcise',
        'environmental',
        'luxuryOnce',
        'annualLuxury',
        'registrationEstimate',
      ].includes(id)
        ? id
        : 'service',
    );
  }
  function methodText(line: CalculationLine) {
    return line.method
      ? tm(line.method.key, formatMethodParameters(line.method.params, locale))
      : td('fallback');
  }
  function formulaText(line: CalculationLine) {
    return formatFeeFormula(line, result.currency, locale, {
      maximum: td('maximum'),
      lookup: td('lookup'),
      amount: td('amount'),
    });
  }
  async function copy() {
    if (result.total === null) return;
    const quoteText = (value: CopyQuoteText) =>
      'text' in value
        ? value.text
        : value.namespace === 'Calculator'
          ? t(value.key)
          : tq(value.key);
    const quoteFacts = getCopyQuoteFacts(normalized, result, country, initialRates, manualRates);
    const text = [
      `${siteConfig.name} · ${tc(country.code)}`,
      ...(scopeLabel ? [scopeLabel] : []),
      tq('parametersTitle'),
      ...quoteFacts.map((fact) => `${quoteText(fact.label)}: ${quoteText(fact.value)}`),
      t('costBreakdown'),
      ...lines.flatMap((line) => [
        `${feeLabel(line.id)}: ${format(line.amount)} ${result.currency} (${usdText(line.amount)})`,
        methodText(line),
        `${td('formula')}: ${formulaText(line)}`,
      ]),
      `${t('importTotal')}: ${format(result.total)} ${result.currency} (${usdText(result.total)})`,
      ...(result.additionalCosts.length
        ? [
            t('additionalCostsTitle'),
            ...result.additionalCosts.flatMap((line) => [
              `${feeLabel(line.id)}: ${format(line.amount)} ${result.currency} (${usdText(line.amount)})`,
              methodText(line),
              `${td('formula')}: ${formulaText(line)}`,
            ]),
          ]
        : []),
      ...result.assumptions.map((key) => ta(key)),
      t('usdReferenceHint'),
      t('referenceNotice'),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }
  function showResult() {
    setTouched(new Set(result.missingFields));
    if (
      result.missingFields.some((key) =>
        ['transactionRate', 'euroRate', 'usdRate', 'customsDate'].includes(key),
      )
    )
      setAdvanced(true);
    document.getElementById('calculation-result')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
  }
  function field(
    key: InputField,
    label: string,
    options: { type?: string; unit?: string; children?: ReactNode } = {},
  ) {
    const code = result.fieldErrors[key];
    const error = code
      ? te(errorMap[code] || 'invalid_number')
      : touched.has(key) && result.missingFields.includes(key)
        ? te('required')
        : '';
    return (
      <div className={`form-field ${error ? 'has-error' : ''}`}>
        <label htmlFor={key}>{label}</label>
        <div className="input-wrap">
          <input
            id={key}
            name={key}
            type={options.type || 'text'}
            inputMode={options.type ? undefined : 'decimal'}
            value={input[key] ?? ''}
            onChange={(event) => update(key, event.target.value)}
            onBlur={() => setTouched((old) => new Set(old).add(key))}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${key}-error` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {options.unit && <span className="input-unit">{options.unit}</span>}
          {options.children}
        </div>
        {error && (
          <small className="field-error" id={`${key}-error`}>
            {error}
          </small>
        )}
      </div>
    );
  }

  return (
    <main id="main" className="calculator-main calculator-simple">
      <section className="hero shell simple-hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <span className="eyebrow">
            <span />
            {t('originLabel')}
          </span>
          <h1 id="page-title">{t('pageTitle', { country: tc(country.code) })}</h1>
          <p>{t('simpleDescription')}</p>
        </div>
        <span className="route-pill">
          CN <Icon name="arrow" size={16} /> {country.code}
        </span>
      </section>
      <div className="shell">
        <nav className="country-nav" aria-label={t('destination')} ref={countryNavRef}>
          {countries.map((item) => (
            <Link
              key={item.code}
              href={`/calculator/${item.slug}/`}
              className={`country-tab ${country.code === item.code ? 'active' : ''}`}
              aria-current={country.code === item.code ? 'page' : undefined}
            >
              <span className="country-flag" aria-hidden="true">
                {item.flag}
              </span>
              <span>{tc(item.code)}</span>
            </Link>
          ))}
        </nav>
        <div className="calculator-grid">
          <section className="form-card panel" aria-labelledby="form-title" data-motion-reveal>
            <div className="card-heading">
              <div>
                <h2 id="form-title">{t('simpleFormTitle')}</h2>
                <p>{t('defaultsReady')}</p>
              </div>
              <button type="button" className="reset-button" onClick={reset} disabled={!ready}>
                <Icon name="refresh" size={14} />
                {t('restoreDefaults')}
              </button>
            </div>
            <fieldset className="form-content" disabled={!ready || input.country !== country.code}>
              {country.needsPrice && (
                <div className="price-row">
                  {field('price', t('price'), {
                    children: (
                      <select
                        aria-label={t('currency')}
                        className="currency-select"
                        value={input.currency}
                        onChange={(event) => changeCurrency(event.target.value as 'CNY' | 'USD')}
                      >
                        <option value="CNY">CNY ¥</option>
                        <option value="USD">USD $</option>
                      </select>
                    ),
                  })}
                </div>
              )}
              <div className="field-grid">
                {needsDisplacement && field('displacementCc', t('displacement'), { unit: 'cc' })}
                {country.needsPower &&
                  field('powerHp', t(isElectric ? 'electricPower' : 'power'), { unit: 'hp' })}
                {country.needsManufactureDate &&
                  field('manufactureDate', t('manufactureDate'), { type: 'month' })}
              </div>
              <fieldset className="powertrain-field">
                <legend>{t('powertrain')}</legend>
                <div className="powertrain-grid simple-powertrain">
                  {(['fuel', 'hybrid', 'electric'] as const).map((group) => (
                    <button
                      type="button"
                      key={group}
                      className={fuelGroup === group ? 'selected' : ''}
                      aria-pressed={fuelGroup === group}
                      onClick={() =>
                        fuelGroup !== group &&
                        update(
                          'powertrain',
                          group === 'electric' ? 'bev' : group === 'hybrid' ? 'hev' : 'petrol',
                        )
                      }
                    >
                      {group === 'electric' && <Icon name="spark" size={13} />}
                      <span>
                        {t(
                          group === 'fuel' ? 'petrolDiesel' : group === 'hybrid' ? 'hybrid' : 'bev',
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
              {country.code === 'UZ' && (
                <div className="form-field condition-field">
                  <label htmlFor="condition">{t('condition')}</label>
                  <div className="input-wrap">
                    <select
                      id="condition"
                      value={input.condition ?? 'used'}
                      onChange={(event) =>
                        update('condition', event.target.value as 'new' | 'used')
                      }
                    >
                      <option value="used">{t('usedVehicle')}</option>
                      <option value="new">{t('newVehicle')}</option>
                    </select>
                    <Icon name="chevron" size={15} />
                  </div>
                  <small className="condition-help">{t('conditionHelp')}</small>
                </div>
              )}
              <details
                className="advanced-settings"
                open={advanced}
                onToggle={(event) => setAdvanced(event.currentTarget.open)}
              >
                <summary>
                  <span>
                    <Icon name="plus" size={16} />
                    {t('moreSettings')}
                  </span>
                  <span className="advanced-summary">
                    {scopeLabel}
                    <Icon name="chevron" size={16} />
                  </span>
                </summary>
                <div className="advanced-content">
                  <p>{t('settingsHelp')}</p>
                  <div className="field-grid">
                    {country.hasImporterChoice && (
                      <div className="form-field">
                        <label htmlFor="importerType">{t('importer')}</label>
                        <div className="input-wrap">
                          <select
                            id="importerType"
                            value={input.importerType}
                            onChange={(event) =>
                              update('importerType', event.target.value as 'individual' | 'company')
                            }
                          >
                            <option value="individual">{t('personal')}</option>
                            <option value="company">{t('company')}</option>
                          </select>
                          <Icon name="chevron" size={15} />
                        </div>
                      </div>
                    )}
                    <div className="form-field">
                      <label htmlFor="powertrainDetail">{t('powertrainDetail')}</label>
                      <div className="input-wrap">
                        <select
                          id="powertrainDetail"
                          value={input.powertrain}
                          onChange={(event) =>
                            update('powertrain', event.target.value as Powertrain)
                          }
                        >
                          {CALCULATOR_POWERTRAINS.map((powertrain) => (
                            <option key={powertrain} value={powertrain}>
                              {t(powertrain)}
                            </option>
                          ))}
                        </select>
                        <Icon name="chevron" size={15} />
                      </div>
                    </div>
                    {field('customsDate', t('customsDate'), { type: 'date' })}
                    {country.needsSteering && (
                      <div className="form-field">
                        <label htmlFor="steering">{t('steering')}</label>
                        <div className="input-wrap">
                          <select
                            id="steering"
                            value={input.steering}
                            onChange={(event) =>
                              update('steering', event.target.value as 'left' | 'right')
                            }
                          >
                            <option value="left">{t('left')}</option>
                            <option value="right">{t('right')}</option>
                          </select>
                          <Icon name="chevron" size={15} />
                        </div>
                      </div>
                    )}
                    {country.needsPrice &&
                      field('transactionRate', t('transactionRate'), {
                        unit: `${country.currency}/${input.currency}`,
                      })}
                    {country.needsEuroRate &&
                      field('euroRate', t('euroRate'), { unit: `${country.currency}/EUR` })}
                    {country.code === 'UZ' &&
                      input.currency !== 'USD' &&
                      field('usdRate', t('usdRate'), { unit: `${country.currency}/USD` })}
                    {country.needsFreight &&
                      field('freight', t('freight'), { unit: input.currency })}
                    {country.needsFreight &&
                      field('insurance', t('insurance'), { unit: input.currency })}
                  </div>
                  <p className="currency-auto-hint">{t('currencyAutoHint')}</p>
                  {country.needsFreight && (
                    <p className="currency-auto-hint">{t('transportEstimateHelp')}</p>
                  )}
                </div>
              </details>
              {
                <div className="fx-caption" data-testid="fx-status">
                  <Icon name="clock" size={13} />
                  <span>
                    {manualRates && country.needsPrice
                      ? t('ratesManual')
                      : t(initialRates.status === 'live' ? 'ratesAuto' : 'ratesReference', {
                          date: initialRates.asOf,
                        })}
                  </span>
                  <a href={EXCHANGE_RATE_ATTRIBUTION.url} target="_blank" rel="noreferrer">
                    {EXCHANGE_RATE_ATTRIBUTION.label} <Icon name="diagonal" size={10} />
                  </a>
                </div>
              }
            </fieldset>
          </section>
          <aside className="results-column">
            <section
              className="result-card panel"
              id="calculation-result"
              aria-labelledby="result-title"
              data-motion-reveal
            >
              <div className="result-card-top">
                <Image
                  className="result-brand-watermark"
                  src={siteConfig.brand.logo.src}
                  width={siteConfig.brand.logo.width}
                  height={siteConfig.brand.logo.height}
                  sizes="(max-width: 600px) 140px, 180px"
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
                <h2 id="result-title">{t('resultTitle')}</h2>
                <ResultStamp input={normalized} result={result} />
              </div>
              <div className="destination-summary">
                <span className="country-flag" aria-hidden="true">
                  {country.flag}
                </span>
                <div>
                  <strong>{tc(country.code)}</strong>
                  <span>
                    CN <Icon name="arrow" size={12} /> {country.code}
                    {scopeLabel && (
                      <>
                        <i>·</i> {scopeLabel}
                      </>
                    )}
                  </span>
                </div>
                <span className="destination-code">{country.code}</span>
              </div>
              {result.status === 'reference' && result.total !== null ? (
                <>
                  <div className="fee-details-toolbar">
                    <span>{t('costBreakdown')}</span>
                    <button
                      type="button"
                      data-testid="toggle-all-fee-details"
                      aria-expanded={allFeesExpanded}
                      aria-controls={visibleFeeIds.join(' ')}
                      onClick={() => setExpandedFees(new Set(allFeesExpanded ? [] : visibleFeeIds))}
                    >
                      {td(allFeesExpanded ? 'collapseAll' : 'expandAll')}
                      <Icon name="chevron" size={13} />
                    </button>
                  </div>
                  <div className="fee-lines">
                    {lines.map((line) => (
                      <FeeLine
                        key={line.id}
                        line={line}
                        label={feeLabel(line.id)}
                        amount={format(line.amount)}
                        usd={usdText(line.amount)}
                        currency={result.currency}
                        detailsId={feeDetailsId(line)}
                        expanded={expandedFees.has(feeDetailsId(line))}
                        onToggle={() => toggleFee(feeDetailsId(line))}
                      />
                    ))}
                  </div>
                  <div className="total-block" ref={totalRef}>
                    <span>{t('importTotal')}</span>
                    <div className="total-amount" data-testid="total">
                      <strong>{format(result.total)}</strong>
                      <span>{result.currency}</span>
                    </div>
                    <div className="total-usd" data-testid="total-usd">
                      {usdText(result.total)}
                    </div>
                    <small className="usd-reference-hint">{t('usdReferenceHint')}</small>
                    <p>{t('notLanded')}</p>
                  </div>
                  {result.assumptions.length > 0 && (
                    <div className="calculation-assumptions" data-testid="calculation-assumptions">
                      <ul>
                        {result.assumptions.map((key) => (
                          <li key={key}>{ta(key)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.additionalCosts.length > 0 && (
                    <section
                      className="additional-costs"
                      data-testid="additional-costs"
                      aria-labelledby="additional-costs-title"
                    >
                      <h3 id="additional-costs-title">{t('additionalCostsTitle')}</h3>
                      {result.additionalCosts.map((line) => (
                        <FeeLine
                          key={line.id}
                          line={line}
                          label={feeLabel(line.id)}
                          amount={format(line.amount)}
                          usd={usdText(line.amount)}
                          currency={result.currency}
                          detailsId={feeDetailsId(line, true)}
                          expanded={expandedFees.has(feeDetailsId(line, true))}
                          onToggle={() => toggleFee(feeDetailsId(line, true))}
                          additional
                        />
                      ))}
                    </section>
                  )}
                </>
              ) : (
                <div className="result-empty" data-testid="result-status">
                  <div className="empty-orbit">
                    <Icon name={result.status === 'needs_review' ? 'clock' : 'info'} size={26} />
                  </div>
                  <h3>
                    {t(
                      result.status === 'needs_review'
                        ? 'reviewTitle'
                        : result.status === 'invalid'
                          ? 'invalidTitle'
                          : 'missingTitle',
                    )}
                  </h3>
                  <p>
                    {result.status === 'needs_review' && result.reason
                      ? tr(reasonMap[result.reason] || 'country_pending')
                      : t(
                          result.status === 'invalid' ? 'invalidDescription' : 'missingDescription',
                        )}
                  </p>
                </div>
              )}
              {result.status === 'reference' && (
                <p className="formula-precision-note">{td('precision')}</p>
              )}
              <CountryPolicyNotes input={normalized} />
              <button
                type="button"
                className="copy-button"
                disabled={result.total === null}
                onClick={copy}
              >
                <Icon name={copyState === 'copied' ? 'check' : 'copy'} size={16} />
                {t(
                  copyState === 'copied'
                    ? 'copied'
                    : copyState === 'failed'
                      ? 'copyFailed'
                      : 'copy',
                )}
              </button>
              <span className="sr-only" role="status" aria-live="polite">
                {result.total !== null
                  ? `${t('importTotal')}: ${format(result.total)} ${result.currency}`
                  : t('unavailable')}
              </span>
            </section>
          </aside>
        </div>
        <section className="faq-section simple-faq" aria-labelledby="faq-title">
          <div className="section-intro">
            <h2 id="faq-title">{t('faqEyebrow')}</h2>
          </div>
          <div className="faq-list">
            {([1, 4] as const).map((n) => (
              <details key={n}>
                <summary>
                  {t(`faq${n}Q`)}
                  <Icon name="plus" size={18} />
                </summary>
                <p>{t(`faq${n}A`)}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
      <div className={`mobile-result-bar ${keyboardOpen ? 'keyboard-open' : ''}`}>
        <div>
          <span>{t('importTotal')}</span>
          <strong>
            {result.total === null ? '—' : format(result.total)}{' '}
            <small>{result.total !== null ? result.currency : ''}</small>
          </strong>
          {result.total !== null && (
            <small className="mobile-total-usd" data-testid="mobile-total-usd">
              {usdText(result.total)}
            </small>
          )}
        </div>
        <button type="button" onClick={showResult}>
          {t('viewResult')}
          <Icon name="arrow" size={17} />
        </button>
      </div>
    </main>
  );
}
