'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { calculateImportEstimate, type CalculationLine, type CountryCode } from '../index';
import { countries, getCountryByCode } from '../config/countries';
import { CALCULATOR_POWERTRAINS } from '../application/draft';
import { convertTransactionPrice } from '../application/defaults';
import { convertImportAmountToUsd } from '../application/display-currency';
import { normalizePageInput } from '../application/page-input';
import { createVehicleEstimateFragment } from '../application/estimate-seed';
import { vehicleManufacturePrefill } from '../application/manufacture-estimate';
import {
  createVehicleEstimateDraft, vehicleEstimateIdentity, vehicleEstimateInput,
  vehicleEstimateMissingLabel, type VehicleEstimateDraft,
} from '../application/vehicle-estimate';
import { vehicleEstimateCopy } from '../application/vehicle-estimate-copy';
import { deriveRates, type ExchangeRateSnapshot } from '../infrastructure/exchange-rates';
import { FeeLine } from './fee-line';
import styles from './vehicle-import-estimate.module.css';

type Field = 'price' | 'displacementCc' | 'powerHp' | 'manufactureDate' | 'customsDate'
  | 'freight' | 'insurance' | 'transactionRate' | 'euroRate' | 'usdRate';
const errors: Record<string, string> = {
  invalid_option: 'invalid_number', invalid_decimal: 'invalid_number',
  must_be_positive: 'positive_required', invalid_month: 'invalid_date',
  invalid_date: 'invalid_date', manufacture_after_customs: 'future_manufacture',
};
const reasons: Record<string, string> = {
  company_rules_pending: 'company_pending', powertrain_rules_pending: 'powertrain_pending',
  recycling_rules_pending: 'power_pending', rule_date_outside_reference: 'year_pending',
};

export function VehicleImportEstimate({ vehicle, locale, initialDate, initialRates, disabled = false }: {
  vehicle: PublicVehicle;
  locale: Locale;
  initialDate: string;
  initialRates: ExchangeRateSnapshot;
  disabled?: boolean;
}) {
  const t = useTranslations('Calculator');
  const tc = useTranslations('Countries');
  const tf = useTranslations('Fees');
  const te = useTranslations('Errors');
  const tr = useTranslations('Reasons');
  const ta = useTranslations('Assumptions');
  const td = useTranslations('FeeDisplay');
  const copy = vehicleEstimateCopy[locale];
  const prefix = useId();
  const identity = JSON.stringify([vehicleEstimateIdentity(vehicle), initialDate, initialRates]);
  const [state, setState] = useState(() => ({
    identity,
    input: createVehicleEstimateDraft(vehicle, 'RU', initialDate, initialRates),
    manufactureEdited: false,
  }));
  const [ready, setReady] = useState(false);
  const [manualRates, setManualRates] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // A changed DTO never renders an old result/seed, including before this effect runs.
  const current = state.identity === identity;
  const input = current ? state.input : createVehicleEstimateDraft(vehicle, 'RU', initialDate, initialRates);
  const country = getCountryByCode(input.country)!;
  const active = ready && !disabled && current;
  const manufactureEstimate = !current || state.manufactureEdited
    ? undefined
    : vehicleManufacturePrefill(vehicle, initialDate).estimate;
  const manufactureNote = country.needsManufactureDate && manufactureEstimate
    ? t(manufactureEstimate === 'model_year' ? 'modelYearEstimate' : 'manufactureYearEstimate', {
        year: input.manufactureDate.slice(0, 4),
      })
    : undefined;
  const normalized = useMemo(() => normalizePageInput(vehicleEstimateInput(input), country), [input, country]);
  const result = useMemo(() => calculateImportEstimate(normalized), [normalized]);
  const formatter = useMemo(() => new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : locale, {
    maximumFractionDigits: 2,
  }), [locale]);
  const separator = formatter.formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  const format = (value: string) => {
    const match = /^(-?\d+)(?:\.(\d+))?$/.exec(value);
    return match ? `${formatter.format(BigInt(match[1]))}${match[2] ? separator + match[2] : ''}` : '—';
  };
  const usd = (value: string) => {
    const converted = convertImportAmountToUsd(value, normalized, initialRates);
    return converted === null ? '— USD' : `≈ ${format(converted)} USD`;
  };

  useEffect(() => {
    setState((previous) => previous.identity === identity ? previous : {
      identity, input: createVehicleEstimateDraft(vehicle, 'RU', initialDate, initialRates),
      manufactureEdited: false,
    });
    setExpanded(new Set());
    setManualRates(false);
    setReady(true);
    // identity includes all consumed facts/date/rates; equal DTO objects retain edits and the manual label.
  }, [identity]);

  function update<K extends keyof VehicleEstimateDraft>(key: K, value: VehicleEstimateDraft[K]) {
    if (key === 'transactionRate' || key === 'euroRate' || key === 'usdRate') setManualRates(true);
    setState((previous) => ({
      ...previous,
      manufactureEdited: previous.manufactureEdited || key === 'manufactureDate',
      input: {
        ...previous.input, [key]: value,
        ...(key === 'transactionRate' && previous.input.country === 'UZ' && previous.input.currency === 'USD'
          ? { usdRate: String(value) } : {}),
      },
    }));
  }
  function changeCountry(code: CountryCode) {
    setManualRates(false);
    setState((previous) => ({ ...previous, input: {
      ...previous.input, country: code, importerType: 'individual',
      ...deriveRates(initialRates, code, previous.input.currency),
    } }));
    setExpanded(new Set());
  }
  function changeCurrency(currency: 'CNY' | 'USD') {
    setManualRates(false);
    setState((previous) => ({ ...previous, input: {
      ...previous.input, currency,
      price: convertTransactionPrice(previous.input.price, previous.input.currency, currency, initialRates),
      freight: convertTransactionPrice(previous.input.freight, previous.input.currency, currency, initialRates),
      insurance: convertTransactionPrice(previous.input.insurance, previous.input.currency, currency, initialRates),
      ...deriveRates(initialRates, previous.input.country, currency),
    } }));
  }
  function field(key: Field, label: string, options: { type?: 'month' | 'date'; unit?: string; note?: string } = {}) {
    const { type, unit, note } = options;
    const error = result.fieldErrors[key];
    const id = `${prefix}-${key}`;
    const describedBy = [error && `${id}-error`, note && `${id}-note`].filter(Boolean).join(' ');
    return <div className={styles.field}>
      <label htmlFor={id}>{label}{unit && <span>{unit}</span>}</label>
      <input id={id} name={key} value={input[key] ?? ''} type={type ?? 'text'}
        inputMode={type ? undefined : 'decimal'} autoComplete="off" spellCheck={false}
        aria-invalid={Boolean(error)} aria-describedby={describedBy || undefined}
        onChange={(event) => update(key, event.target.value)} />
      {error && <small id={`${id}-error`} className={styles.error}>{te(errors[error] ?? 'invalid_number')}</small>}
      {note && <small id={`${id}-note`} className={styles.dateNote}>{note}</small>}
    </div>;
  }
  function select(key: 'powertrain' | 'condition' | 'steering' | 'importerType', label: string, children: ReactNode) {
    const id = `${prefix}-${key}`;
    return <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <select id={id} name={key} value={input[key]} onChange={(event) => update(key, event.target.value as never)}>
        {children}
      </select>
    </div>;
  }
  const emptyOption = <option value="">{vehicleEstimateMissingLabel(locale)}</option>;
  const seed = active ? createVehicleEstimateFragment({
    version: 1, sourceId: vehicle.id, input, rates: initialRates,
    ...(manufactureEstimate ? { manufactureEstimate } : {}),
  }) : null;
  const toolHref = `/${locale}/calculator/${country.slug}/${seed ?? ''}`;
  const feeId = (line: CalculationLine, extra = false) => `${prefix}-${country.code}-${extra ? 'extra-' : ''}${line.id}`;
  const allIds = [...result.lines.map((line) => feeId(line)), ...result.additionalCosts.map((line) => feeId(line, true))];
  const allExpanded = allIds.length > 0 && allIds.every((id) => expanded.has(id));
  const labels: Partial<Record<keyof VehicleEstimateDraft, string>> = {
    powertrain: t('powertrain'),
    price: t('price'),
    displacementCc: t('displacement'),
    powerHp: t(input.powertrain === 'bev' ? 'electricPower' : 'power'),
    manufactureDate: t('manufactureDate'),
    customsDate: t('customsDate'),
    condition: t('condition'),
    steering: t('steering'),
    transactionRate: t('transactionRate'),
    euroRate: t('euroRate'),
    usdRate: t(input.currency === 'USD' ? 'transactionRate' : 'usdRate'),
  };
  const missingLabels = active && result.status === 'incomplete'
    ? [...new Set(result.missingFields.map((field) => labels[field as keyof VehicleEstimateDraft]).filter(Boolean))]
    : [];
  function renderLine(line: CalculationLine, additional = false) {
    const id = feeId(line, additional);
    return <FeeLine key={id} line={line} label={tf(line.id)} amount={format(line.amount)} usd={usd(line.amount)}
      currency={result.currency} detailsId={id} expanded={expanded.has(id)} additional={additional}
      onToggle={() => setExpanded((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      })} />;
  }

  return <div className={styles.panel} data-testid="vehicle-import-estimate" data-country={country.code}>
    <p className={styles.intro}>{copy.facts}</p>
    {country.personalReference && <p className={styles.note}>{t('personal')}</p>}
    <fieldset className={styles.fields} disabled={!active}>
      <div className={styles.field}>
        <label htmlFor={`${prefix}-country`}>{t('destination')}</label>
        <select id={`${prefix}-country`} name="country" value={country.code}
          onChange={(event) => changeCountry(event.target.value as CountryCode)}>
          {countries.map((item) => <option key={item.code} value={item.code}>{item.flag} {tc(item.code)}</option>)}
        </select>
      </div>
      {country.needsPrice && <div className={styles.priceRow}>
        {field('price', t('price'))}
        <div className={styles.field}>
          <label htmlFor={`${prefix}-currency`}>{t('currency')}</label>
          <select id={`${prefix}-currency`} name="currency" value={input.currency}
            onChange={(event) => changeCurrency(event.target.value as 'CNY' | 'USD')}>
            <option value="USD">USD</option><option value="CNY">CNY</option>
          </select>
        </div>
      </div>}
      {vehicle.price.kind === 'reference' && country.needsPrice && input.price && (
        <p className={styles.note}>{copy.referencePrice}</p>
      )}
      {select('powertrain', t('powertrain'), <>{emptyOption}{CALCULATOR_POWERTRAINS.map((value) =>
        <option key={value} value={value}>{t(value)}</option>)}</>)}
      {input.powertrain !== 'bev' && !(country.code === 'KG' && input.powertrain === 'erev')
        && field('displacementCc', t('displacement'))}
      {country.needsPower && <>
        {field('powerHp', t(input.powertrain === 'bev' ? 'electricPower' : 'power'))}
        {vehicle.facts.powerKw !== null && vehicle.facts.powerKw > 0 && <p className={styles.note}>{copy.convertedPower}</p>}
      </>}
      {country.needsManufactureDate && field('manufactureDate', t('manufactureDate'), { type: 'month', note: manufactureNote })}
      {country.code === 'UZ' && select('condition', t('condition'), <>{emptyOption}
        <option value="used">{t('usedVehicle')}</option><option value="new">{t('newVehicle')}</option></>)}
      {country.code === 'UZ' && <p className={styles.note}>{t('conditionHelp')}</p>}
      {country.hasImporterChoice && select('importerType', t('importer'), <>
        <option value="individual">{t('personal')}</option><option value="company">{t('company')}</option></>)}
      {country.needsSteering && select('steering', t('steering'), <>{emptyOption}
        <option value="left">{t('left')}</option><option value="right">{t('right')}</option></>)}
      <details className={styles.settings} open>
        <summary>{t('advanced')}<span aria-hidden="true">⌄</span></summary>
        <div className={styles.settingsFields}>
          {field('customsDate', t('customsDate'), { type: 'date' })}
          {country.needsPrice && field('transactionRate', t('transactionRate'), { unit: `${country.currency}/${input.currency}` })}
          {country.needsEuroRate && field('euroRate', t('euroRate'), { unit: `${country.currency}/EUR` })}
          {country.code === 'UZ' && input.currency !== 'USD' && field('usdRate', t('usdRate'), { unit: `${country.currency}/USD` })}
          {country.needsFreight && <>
            {field('freight', t('freight'), { unit: input.currency })}
            {field('insurance', t('insurance'), { unit: input.currency })}
            <p className={styles.note}>{t('transportEstimateHelp')}</p>
          </>}
          <p className={styles.note} data-testid="inline-fx-status">
            {manualRates && <>{t('ratesManual')}<br /></>}
            {t(initialRates.status === 'live' ? 'ratesAuto' : 'ratesReference', { date: initialRates.asOf })}
          </p>
        </div>
      </details>
    </fieldset>
    {active && result.status === 'reference' && result.total !== null ? <section className={styles.result} data-testid="inline-estimate-result">
      <div className={styles.toolbar}>
        <h3>{t('costBreakdown')}</h3>
        <button type="button" aria-expanded={allExpanded} aria-controls={allIds.join(' ')}
          onClick={() => setExpanded(new Set(allExpanded ? [] : allIds))}>
          {td(allExpanded ? 'collapseAll' : 'expandAll')}
        </button>
      </div>
      {result.lines.map((line) => renderLine(line))}
      <div className={styles.total}>
        <span>{t('importTotal')}</span>
        <strong data-testid="inline-estimate-total">{format(result.total)} <small>{result.currency}</small></strong>
        <span data-testid="inline-estimate-usd">{usd(result.total)}</span>
        <p>{t('notLanded')}</p>
      </div>
      {manufactureNote && <p className={styles.resultDateNote}>{manufactureNote}</p>}
      {result.additionalCosts.length > 0 && <div className={styles.additional}>
        <h3>{t('additionalCostsTitle')}</h3>
        {result.additionalCosts.map((line) => renderLine(line, true))}
      </div>}
      {result.assumptions.length > 0 && <ul className={styles.assumptions}>
        {result.assumptions.map((value) => <li key={value}>{ta(value)}</li>)}
      </ul>}
      <p className={styles.note}>{t('simpleReferenceNotice')}</p>
      <p className={styles.note}>{t('excludedDescription')}</p>
    </section> : <div className={styles.status} data-testid="inline-estimate-status" role="status">
      <Icon name="info" size={19} />
      <div>
        <strong>
          {disabled ? copy.waiting : !active ? copy.loading
            : result.status === 'needs_review' ? tr(reasons[result.reason ?? ''] ?? 'country_pending')
            : result.status === 'invalid' ? t('invalidDescription') : t('completeInputs')}
        </strong>
        {missingLabels.length > 0 && (
          <ul>{missingLabels.map((label) => <li key={label}>{label}</li>)}</ul>
        )}
      </div>
    </div>}
    <a className={styles.fullTool} href={toolHref} data-testid="vehicle-full-calculator">{copy.completeTool}<span aria-hidden="true">↗</span></a>
    {active && !seed && <p className={styles.note}>{copy.seedHint}</p>}
  </div>;
}
