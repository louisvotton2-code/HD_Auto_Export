function roundedDecimal(value: string, precision: number) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const [, sign, integer, fraction = ''] = match;
  const scale = 10n ** BigInt(precision);
  const units = BigInt(integer) * scale + BigInt(fraction.slice(0, precision).padEnd(precision, '0') || '0')
    + ((fraction[precision] ?? '0') >= '5' ? 1n : 0n);
  return {
    sign: sign && units !== 0n ? '-' : '',
    integer: units / scale,
    decimal: precision ? String(units % scale).padStart(precision, '0') : '',
  };
}

/** Round for display without converting the underlying decimal to a floating-point number. */
export function formatDisplayAmount(value: string, locale: string, minimumDecimals = 0, maximumDecimals = 2): string {
  const rounded = roundedDecimal(value, maximumDecimals);
  if (!rounded) return '—';
  const formatter = new Intl.NumberFormat(locale);
  const whole = formatter.format(rounded.integer);
  const decimal = rounded.decimal.replace(/0+$/, '').padEnd(minimumDecimals, '0');
  const separator = decimal ? formatter.formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.' : '';
  return `${rounded.sign}${whole}${separator}${decimal}`;
}

/** Editable inputs use an ASCII decimal point and retain their exact value in state. */
export function formatDecimalInput(value: string, precision: number): string {
  const rounded = roundedDecimal(value, precision);
  if (!rounded) return value;
  return `${rounded.sign}${rounded.integer}${rounded.decimal ? '.' + rounded.decimal : ''}`;
}
