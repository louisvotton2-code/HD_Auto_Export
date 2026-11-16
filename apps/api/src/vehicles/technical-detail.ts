import { vehicleConfigurationItemId, type VehicleConfiguration } from '@hd/contracts/admin';
import {
  VEHICLE_POWER_DETAIL_KEYS,
  type ConfigurationDisplay, type DisplayText, type Locale, type VehicleDetailMatchKey, type VehicleExtraFacts,
  type VehicleFacts, type VehicleTechnicalDetails,
} from '@hd/contracts/public';
import { configurationTechnicalKey, configurationTechnicalValue } from './configuration-technical-facts.js';
import { technicalFactsIdentity } from './localization.js';

type TechnicalProjection = { technicalDetails?: VehicleTechnicalDetails; vehicleClass?: DisplayText };
type ComparableFacts = Partial<Record<VehicleDetailMatchKey, number | string | null>>;

/** Match only the configuration rows whose visible value agrees with the independently displayed fact. */
export function projectTechnicalDetail(
  facts: VehicleFacts, extra: VehicleExtraFacts | undefined, raw: VehicleConfiguration | null | undefined,
  configuration: ConfigurationDisplay | null | undefined, locale: Locale,
): TechnicalProjection {
  const verified = extra?.verifiedTechnical?.identityHash === technicalFactsIdentity(facts) ? extra.verifiedTechnical : undefined;
  const power: VehicleTechnicalDetails['power'] = {};
  for (const key of VEHICLE_POWER_DETAIL_KEYS) {
    const value = verified?.[key];
    if (value !== undefined) power[key] = value;
  }
  const vehicleClass = verified?.vehicleClass?.value;
  const primary: ComparableFacts = {
    displacementCc: facts.engineCc, powerKw: facts.powerKw, powerHp: facts.powerHp,
    bodyType: facts.body === 'unknown' ? null : facts.body,
    transmissionType: facts.transmission === 'unknown' ? null : facts.transmission,
    driveType: extra?.drivetrain,
    energyType: facts.powertrain === 'unknown' ? null : facts.powertrain,
  };
  const imported: ComparableFacts = { ...power, vehicleClass: vehicleClass?.zh };
  const original = new Map(raw?.items.map(item => [vehicleConfigurationItemId(item.name), item]));
  const configurationMatches: VehicleTechnicalDetails['configurationMatches'] = [];
  for (const item of configuration?.items ?? []) {
    const sourceItem = original.get(item.id);
    if (!sourceItem || item.name.status !== 'ready' || item.value.status !== 'ready') continue;
    const semanticKey = configurationTechnicalKey(sourceItem.name);
    if (!semanticKey) continue;
    const intended = primary[semanticKey] ?? imported[semanticKey];
    if (intended == null) continue;
    if (configurationTechnicalValue(semanticKey, sourceItem.name, sourceItem.value, 'zh') !== intended) continue;
    const rendered = configurationTechnicalValue(semanticKey, item.name.text, item.value.text, locale);
    if (rendered !== (semanticKey === 'vehicleClass' ? vehicleClass?.[locale] : intended)) continue;
    configurationMatches.push({ id: item.id, semanticKey, source: primary[semanticKey] == null ? 'configuration' : 'record' });
  }
  const projected: TechnicalProjection = {};
  if (Object.keys(power).length || configurationMatches.length) projected.technicalDetails = { power, configurationMatches };
  if (vehicleClass) projected.vehicleClass = {
    status: 'ready', text: vehicleClass[locale], requestedLocale: locale, contentLocale: locale, provenance: 'human', reviewed: false,
  };
  return projected;
}
