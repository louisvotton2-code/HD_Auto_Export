'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/routing';
import { formatDisplayAmount } from '@/shared/lib/display-amount';
import { CountryFlag } from '@/shared/ui/country-flag';
import { Icon } from '@/shared/ui/icon';
import { useDestinationCountry } from '@/shared/ui/use-destination-country';
import { DestinationCountryUrlObserver } from '@/shared/ui/destination-country-url-observer';
import { calculateImportEstimate, type CalculationLine, type CountryCode } from '../index';
import { countries, getCountryByCode } from '../config/countries';
import { CALCULATOR_POWERTRAINS, isEnginePowerPrefill } from '../application/draft';
import { convertTransactionPrice } from '../application/defaults';
import { convertImportAmountToUsd } from '../application/display-currency';
import { normalizePageInput, usesAssessedPrice } from '../application/page-input';
import { calculatorErrorKey, calculatorReasonKey } from '../application/calculator-status';
import { needsTajikTariffInputs, TAJIK_TARIFF_FIELDS, type TajikTariffField } from '../core/tajik-input';
import { getClearanceDate, visitYearForDefault } from '../application/current-date';
import { createVehicleEstimateFragment } from '../application/estimate-seed';
import { calculateRecentJanuaryEstimates } from '../application/manufacture-range';
import { manufactureRangeCopy } from '../application/manufacture-range-copy';
import {
  createVehicleEstimateDraft, retargetVehicleEstimateDraft, vehicleEstimateIdentity, vehicleEstimateInput,
  vehicleEstimateMissingLabel, vehicleEstimatePower, type VehicleEstimateDraft, type VehicleEstimateSource,
} from '../application/vehicle-estimate';
import { vehicleEstimateCopy } from '../application/vehicle-estimate-copy';
import { deriveRates, type ExchangeRateSnapshot } from '../infrastructure/exchange-rates';
import { FeeLine } from './fee-line';
import { ManufactureRangeResult } from './manufacture-range-result';
import { fieldDisplayPrecision } from './field-display-precision';
import { DecimalDisplayInput } from './decimal-display-input';
import { powerBasis } from '../application/power-basis';
import { NumericDateInput } from './numeric-date-input';
import { useCalculatorCompletion } from './use-calculator-completion';
import styles from './vehicle-import-estimate.module.css';

type Field = 'price' | 'displacementCc' | 'powerHp' | 'manufactureDate' | 'customsDate'
  | 'freight' | 'insurance' | 'transactionRate' | 'euroRate' | 'usdRate' | TajikTariffField;
export function VehicleImportEstimate({ vehicle, locale, initialDate, initialRates, disabled = false }: {
  vehicle: VehicleEstimateSource;
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
  const preference = useDestinationCountry(undefined, vehicle.id);
  const prefix = useId();
  const countryPicker = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const picker = countryPicker.current;
    if (!picker) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (picker?.open && event.target instanceof Node && !picker.contains(event.target)) picker.open = false;
    }
    document.addEventListener('pointerdown', closeOnOutsidePress, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress, true);
  }, []);
  const [visitDate, setVisitDate] = useState<string | null>(null);
  useEffect(() => setVisitDate(getClearanceDate(new Date())), []);
  const calculationDate = visitDate ?? initialDate;
  const identity = JSON.stringify([vehicleEstimateIdentity(vehicle), calculationDate, initialRates]);
  const [state, setState] = useState(() => ({
    identity, customsDateEdited: false,
    input: createVehicleEstimateDraft(vehicle, preference.country, calculationDate, initialRates),
  }));
  const [ready, setReady] = useState(false);
  const [manualRates, setManualRates] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // A changed DTO never renders an old result/seed, including before this effect runs.
  const current = state.identity === identity;
  const input = current ? state.input : createVehicleEstimateDraft(vehicle, preference.country, calculationDate, initialRates);
  const publishedPower = vehicleEstimatePower(vehicle);
  const enginePowerPrefill = isEnginePowerPrefill(
    Boolean(publishedPower && publishedPower.source !== 'reported' && input.powerHp === publishedPower.hp),
    input.powertrain,
    input.powerHp,
  );
  const country = getCountryByCode(input.country)!;
  const needsTajikTariff = needsTajikTariffInputs(country.code, input.powertrain);
  const active = visitDate !== null && ready && preference.ready && !disabled && current && input.country === preference.country;
  const normalized = useMemo(() => normalizePageInput(vehicleEstimateInput(input), country), [input, country]);
  const referenceYear = visitYearForDefault(calculationDate);
  const dateIsBlank = country.needsManufactureDate && current && normalized.manufactureDate === '';
  const rangeResult = useMemo(() => dateIsBlank ? calculateRecentJanuaryEstimates(normalized, referenceYear) : null,
    [dateIsBlank, normalized, referenceYear]);
  const result = useMemo(() => rangeResult?.result ?? calculateImportEstimate(normalized), [normalized, rangeResult]);
  const recordCalculationEdit = useCalculatorCompletion(active && result.status === 'reference' && result.total !== null);
  const format = (value: string) => formatDisplayAmount(value, locale, 2);
  const usd = (value: string) => {
    const converted = convertImportAmountToUsd(value, normalized, initialRates);
    return converted === null ? '— USD' : `≈ ${formatDisplayAmount(converted, locale, 2)} USD`;
  };

  useEffect(() => {
    if (!preference.ready) return;
    setState(previous => previous.identity === identity
      ? previous.input.country === preference.country ? previous : {
        ...previous, input: retargetVehicleEstimateDraft(previous.input, preference.country, initialRates, vehicle),
      }
      : { identity, customsDateEdited: false, input: createVehicleEstimateDraft(vehicle, preference.country, calculationDate, initialRates) });
    setExpanded(new Set());
    setManualRates(false);
    setReady(true);
    // identity includes all consumed facts/date/rates; equal DTO objects retain edits and the manual label.
  }, [identity, preference.country, preference.ready]);

  function update<K extends keyof VehicleEstimateDraft>(key: K, value: VehicleEstimateDraft[K]) {
    recordCalculationEdit();
    if (key === 'transactionRate' || key === 'euroRate' || key === 'usdRate') setManualRates(true);
    setState((previous) => ({
      ...previous,
      customsDateEdited: previous.customsDateEdited || key === 'customsDate',
      input: {
        ...previous.input, [key]: value,
        ...(key === 'manufactureDate' ? { manufactureDay: undefined, manufactureYear: undefined } : {}),
        ...(key === 'powertrain' && powerBasis(value) !== powerBasis(previous.input.powertrain)
          ? { powerHp: '', ruPowerBasis: undefined } : {}),
        ...(key === 'powerHp' ? { ruPowerBasis: 'declared' as const } : {}),
        ...(key === 'transactionRate' && country.needsUsdRate && previous.input.currency === 'USD'
          ? { usdRate: String(value) } : {}),
      },
    }));
  }
  function changeCountry(code: CountryCode) {
    recordCalculationEdit();
    preference.selectCountry(code);
    setManualRates(false);
    setState((previous) => ({
      ...previous, input: retargetVehicleEstimateDraft(previous.input, code, initialRates, vehicle),
    }));
    setExpanded(new Set());
  }
  function changeCurrency(currency: 'CNY' | 'USD') {
    recordCalculationEdit();
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
      {type ? <NumericDateInput id={id} name={key} value={(key === 'manufactureDate' ? normalized.manufactureDate : input[key]) ?? ''} precision={type} referenceYear={referenceYear} limitToCurrentYear={key === 'manufactureDate'} label={label} locale={locale}
        onChange={value => update(key, value)} describedBy={describedBy || undefined} invalid={Boolean(error)} /> : <>
        <label htmlFor={id}>{label}{unit && <span>{unit}</span>}</label>
        <DecimalDisplayInput precision={fieldDisplayPrecision[key]} id={id} name={key} value={input[key] ?? ''} type="text"
        inputMode="decimal" autoComplete="off" spellCheck={false}
        aria-invalid={Boolean(error)} aria-describedby={describedBy || undefined}
        onChange={(event) => update(key, event.target.value)} />
      </>}
      {error && <small id={`${id}-error`} className={styles.error}>{te(calculatorErrorKey(error))}</small>}
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
    ...(state.customsDateEdited ? { customsDateEdited: true } : {}),
    version: 1, sourceId: vehicle.id, input, rates: initialRates,
    ...(enginePowerPrefill ? { enginePowerPrefill: true } : {}),
  }) : null;
  const toolHref = `/${locale}/calculator/${country.slug}/${seed ?? ''}`;
  const feeId = (line: CalculationLine, extra = false) => `${prefix}-${country.code}-${extra ? 'extra-' : ''}${line.id}`;
  const allIds = [...result.lines.map((line) => feeId(line)), ...result.additionalCosts.map((line) => feeId(line, true))];
  const allExpanded = allIds.length > 0 && allIds.every((id) => expanded.has(id));
  const priceLabel = t(usesAssessedPrice(country.code, input.powertrain) ? 'tjCustomsValue' : 'price');
  const labels: Partial<Record<keyof VehicleEstimateDraft, string>> = {
    powertrain: t('powertrain'),
    price: priceLabel,
    displacementCc: t('displacement'),
    powerHp: t(powerBasis(input.powertrain)),
    manufactureDate: t('manufactureDate'),
    customsDate: t('customsDate'),
    condition: t('condition'),
    steering: t('steering'),
    transactionRate: t('transactionRate'),
    euroRate: t('euroRate'),
    usdRate: t(input.currency === 'USD' ? 'transactionRate' : 'usdRate'),
    tjDutyPercent: t('tjDutyPercent'),
    tjExcisePercent: t('tjExcisePercent'),
    tjExciseMinimum: t('tjExciseMinimum'),
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

  return <div className={styles.panel} data-testid="vehicle-import-estimate" data-country={country.code} data-country-ready={preference.ready}>
    <DestinationCountryUrlObserver />
    <p className={styles.intro}>{copy.facts}</p>
    {country.personalReference && <p className={styles.note}>{t('personal')}</p>}
    <fieldset className={styles.fields} disabled={!active}>
      <div className={styles.field}>
        <span id={`${prefix}-country-label`} className={styles.countryLabel}>{t('destination')}</span>
        <details ref={countryPicker} className={styles.countryPicker} onBlur={event => {
          // WebKit can blur the summary before delivering a tapped option's click.
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }} onKeyDown={event => {
          if (event.key !== 'Escape' || !event.currentTarget.open) return;
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
          event.preventDefault();
        }}>
          <summary data-testid="vehicle-destination-picker" id={`${prefix}-country`} aria-labelledby={`${prefix}-country-label ${prefix}-country-value`}
            tabIndex={active ? undefined : -1} aria-disabled={!active} onClick={event => { if (!active) event.preventDefault(); }}>
            <CountryFlag countryCode={country.code} />
            <span id={`${prefix}-country-value`}>{tc(country.code)}</span><Icon name="chevron" size={15} />
          </summary>
          <ul>{countries.map(item => <li key={item.code}><button type="button" data-country-option={item.code} aria-pressed={item.code === country.code}
            onClick={event => {
              const picker = event.currentTarget.closest('details');
              if (picker) {
                picker.open = false;
                picker.querySelector('summary')?.focus();
              }
              changeCountry(item.code);
            }}><CountryFlag countryCode={item.code} />{tc(item.code)}</button></li>)}</ul>
        </details>
      </div>
      {country.needsPrice && <div className={styles.priceRow}>
        {field('price', priceLabel, country.code === 'TJ' ? { note: t('tjCustomsValueHelp') } : undefined)}
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
        {field('powerHp', t(powerBasis(input.powertrain)))}
        {publishedPower && input.powerHp === publishedPower.hp
          && (publishedPower.source === 'reported' || enginePowerPrefill) && <p className={styles.note}>{
          publishedPower.source === 'engineKw' ? manufactureRangeCopy[locale].convertedEnginePower : manufactureRangeCopy[locale].suppliedPower
        }</p>}
      </>}
      {country.needsManufactureDate && field('manufactureDate', t('manufactureDate'), { type: 'month' })}
      {field('customsDate', t('customsDate'), { type: 'date' })}
      {country.code === 'UZ' && select('condition', t('condition'), <>{emptyOption}
        <option value="used">{t('usedVehicle')}</option><option value="new">{t('newVehicle')}</option></>)}
      {country.code === 'UZ' && <p className={styles.note}>{t('conditionHelp')}</p>}
      {country.hasImporterChoice && select('importerType', t('importer'), <>
        <option value="individual">{t('personal')}</option><option value="company">{t('company')}</option></>)}
      {country.needsSteering && select('steering', t('steering'), <>{emptyOption}
        <option value="left">{t('left')}</option><option value="right">{t('right')}</option></>)}
      <details className={styles.settings} open>
        <summary>{t('advanced')}<Icon name="chevron" size={14} /></summary>
        <div className={styles.settingsFields}>
          {country.needsPrice && field('transactionRate', t('transactionRate'), { unit: `${country.currency}/${input.currency}` })}
          {country.needsEuroRate && (country.code !== 'TJ' || needsTajikTariff) && field('euroRate', t('euroRate'), { unit: `${country.currency}/EUR` })}
          {country.needsUsdRate && input.currency !== 'USD' && field('usdRate', t('usdRate'), { unit: `${country.currency}/USD` })}
          {needsTajikTariff && <>
            {TAJIK_TARIFF_FIELDS.map((key) => (
              <div key={key}>{field(key, t(key), { unit: key === 'tjExciseMinimum' ? 'EUR/cc' : '%' })}</div>
            ))}
            <p className={styles.note}>{t('tjTariffHelp')}</p>
          </>}
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
    {active && rangeResult && result.status !== 'reference' && <ManufactureRangeResult calculation={rangeResult} locale={locale} rates={initialRates} />}
    {active && rangeResult && result.status === 'reference' ? <section className={styles.result} data-testid="inline-estimate-result">
      <ManufactureRangeResult calculation={rangeResult} locale={locale} rates={initialRates} />
    </section> : active && result.status === 'reference' && result.total !== null ? <section className={styles.result} data-testid="inline-estimate-result">
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
            : result.status === 'needs_review' ? tr(calculatorReasonKey(result.reason))
            : result.status === 'invalid' ? t('invalidDescription') : t('completeInputs')}
        </strong>
        {missingLabels.length > 0 && (
          <ul>{missingLabels.map((label) => <li key={label}>{label}</li>)}</ul>
        )}
      </div>
    </div>}
    <a className={styles.fullTool} href={preference.ready ? toolHref : `/${locale}/calculator/`} data-testid="vehicle-full-calculator">{copy.completeTool}<Icon name="diagonal" size={15} /></a>
    {active && !seed && <p className={styles.note}>{copy.seedHint}</p>}
  </div>;
}
