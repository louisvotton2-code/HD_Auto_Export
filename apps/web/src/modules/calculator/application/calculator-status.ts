const errors: Record<string, string> = {
  invalid_option: 'invalid_number',
  invalid_decimal: 'invalid_number',
  must_be_positive: 'positive_required',
  invalid_month: 'invalid_date',
  invalid_date: 'invalid_date',
  manufacture_after_customs: 'future_manufacture',
};

const reasons: Record<string, string> = {
  company_rules_pending: 'company_pending',
  powertrain_rules_pending: 'powertrain_pending',
  recycling_rules_pending: 'power_pending',
  rule_date_outside_reference: 'year_pending',
  tj_age_limit: 'tj_age_limit',
  tj_electric_age_review: 'tj_electric_age_review',
  tm_age_limit: 'tm_age_limit',
  tm_steering_limit: 'tm_steering_limit',
  tm_displacement_review: 'tm_displacement_review',
};

export function calculatorErrorKey(code: string) {
  return errors[code] ?? 'invalid_number';
}

export function calculatorReasonKey(code: string | null) {
  return reasons[code ?? ''] ?? 'country_pending';
}
