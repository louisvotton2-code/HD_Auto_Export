import type { CountryRecord } from '../config/countries';
import type { CalculationInput } from '../core/types';

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
  return {
    ...input,
    country: country.code,
    importerType:
      country.hasImporterChoice && input.country === country.code
        ? input.importerType
        : 'individual',
  };
}
