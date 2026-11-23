import { applyDocumentedYear } from '../core/documented-facts';
import type { CountryRecord } from '../config/countries';
import type { CalculationInput } from '../core/types';

export function usesAssessedPrice(country: string, powertrain: unknown) {
  return country === 'TJ' || (country === 'KZ' && powertrain === 'bev');
}

/**
 * Hidden legacy identity values must not leak across country pages. The v0.1 core
 * still requires an identity; `individual` here is the reference adapter's value,
 * not a claim that a country without a selector covers both legal identities.
 * API callers keep their explicit identity and are never normalized by this helper.
 */
export function normalizePageInput(
  input: CalculationInput,
  country: CountryRecord,
): CalculationInput {
  return applyDocumentedYear({
    ...input,
    country: country.code,
    // The KZ goods form accepts the complete customs value in its single price field.
    // Transport saved on another country's form must not be silently added to it.
    ...(country.code === 'KZ' && input.powertrain === 'bev' ? { freight: '0', insurance: '0' } : {}),
    importerType:
      country.hasImporterChoice && input.country === country.code
        ? input.importerType
        : 'individual',
  });
}
