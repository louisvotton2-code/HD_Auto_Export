import {
  DisplayTextSchema, LocaleSchema, SUPPLIER_TECHNICAL_CONFIGURATION_KEYS, VEHICLE_POWER_DETAIL_KEYS,
  type DisplayText, type Locale, type PublicVehicle, type VehicleDetailMatchKey, type VehicleTechnicalDetails,
} from '@hd/contracts/public';
import { supplierTechnicalEnum, supplierTechnicalMeasurement } from './configuration-technical-facts.js';

type SupplierConfigurationId = keyof typeof SUPPLIER_TECHNICAL_CONFIGURATION_KEYS;
type SupplierRow = { locale: Locale; data: { id: string; name: DisplayText; value: DisplayText } };
type ComparableValue = number | string;
type Candidate = { id: SupplierConfigurationId; value: ComparableValue | null };

// The minted ID determines numeric scope. The displayed value must state its own unit.
const measurementLabels: Partial<Record<VehicleDetailMatchKey, string>> = {
  displacementCc: 'Displacement', powerKw: 'Power',
  engineKw: 'Engine power', motorKw: 'Motor power', systemKw: 'System power',
  engineHp: 'Engine power', motorHp: 'Motor power',
};

function consensusValue(key: VehicleDetailMatchKey, rows: readonly SupplierRow[]): ComparableValue | null {
  if (rows.length !== LocaleSchema.options.length) return null;
  const seen = new Set<Locale>();
  const label = measurementLabels[key];
  let consensus: ComparableValue | null = null;
  for (const { locale, data: { name, value } } of rows) {
    if (seen.has(locale)) return null;
    seen.add(locale);

    const displayName = DisplayTextSchema.safeParse(name);
    const displayValue = DisplayTextSchema.safeParse(value);
    if (!displayName.success || !displayValue.success) return null;
    if (displayName.data.status !== 'ready' || displayName.data.requestedLocale !== locale
      || displayValue.data.status !== 'ready' || displayValue.data.requestedLocale !== locale) return null;
    const { contentLocale, text } = displayValue.data;
    const language = LocaleSchema.options.find(option => option === contentLocale.split('-')[0]?.toLowerCase());
    const comparable = label ? supplierTechnicalMeasurement(key, label, text)
      : language ? supplierTechnicalEnum(key, text, language) : null;
    if (comparable === null || (consensus !== null && comparable !== consensus)) return null;
    consensus = comparable;
  }
  return consensus;
}

export function projectSupplierTechnicalDetails(
  facts: PublicVehicle['facts'], items: readonly SupplierRow[], inlineIds: ReadonlySet<string>,
): VehicleTechnicalDetails | undefined {
  const rowsById = new Map<SupplierConfigurationId, SupplierRow[]>();
  for (const item of items) {
    if (!Object.hasOwn(SUPPLIER_TECHNICAL_CONFIGURATION_KEYS, item.data.id)) continue;
    const id = item.data.id as SupplierConfigurationId;
    const rows = rowsById.get(id);
    if (rows) rows.push(item);
    else rowsById.set(id, [item]);
  }

  const bySemanticKey = new Map<VehicleDetailMatchKey, Candidate[]>();
  for (const [id, rows] of rowsById) {
    const key = SUPPLIER_TECHNICAL_CONFIGURATION_KEYS[id];
    const candidate = { id, value: consensusValue(key, rows) };
    const group = bySemanticKey.get(key);
    if (group) group.push(candidate);
    else bySemanticKey.set(key, [candidate]);
  }

  const recordValues: Partial<Record<VehicleDetailMatchKey, ComparableValue | null>> = {
    displacementCc: facts.engineCc, powerKw: facts.powerKw,
    bodyType: facts.body, transmissionType: facts.transmission, driveType: facts.drivetrain,
  };
  const power: VehicleTechnicalDetails['power'] = {};
  const configurationMatches: VehicleTechnicalDetails['configurationMatches'] = [];
  for (const [key, candidates] of bySemanticKey) {
    const value = candidates[0]?.value ?? null;
    if (value === null || candidates.some(candidate => candidate.value !== value)) continue;
    const powerKey = VEHICLE_POWER_DETAIL_KEYS.find(candidate => candidate === key);
    let source: 'record' | 'configuration';
    if (powerKey && typeof value === 'number') {
      power[powerKey] = value;
      source = 'configuration';
    } else if (recordValues[key] === value) {
      source = 'record';
    } else continue;
    for (const { id } of candidates) {
      if (inlineIds.has(id)) configurationMatches.push({ id, semanticKey: key, source });
    }
  }
  return Object.keys(power).length || configurationMatches.length ? { power, configurationMatches } : undefined;
}
