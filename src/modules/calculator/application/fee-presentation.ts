import { Amount } from '../core/decimal';
import type { CalculationLine } from '../core/types';

const numeric = /^-?\d+(?:\.\d+)?$/;

function numberText(value: string, locale: string, precision: number) {
  const amount = new Amount(value);
  const rounded = amount.toDecimalPlaces(precision);
  const [whole, fraction] = rounded.toFixed().split('.');
  const formatter = new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : locale);
  const separator =
    formatter.formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  return {
    text: `${formatter.format(BigInt(whole))}${fraction ? separator + fraction : ''}`,
    approximate: !rounded.eq(amount),
  };
}

/** Display rounding only. The original operands and policy formula remain unchanged. */
export function formatMethodParameters(
  params: Record<string, string | number>,
  locale: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([key, raw]) => {
      const value = String(raw);
      if (!numeric.test(value)) return [key, value];
      const rate = /rate|coeff|percent|percc|multiplier/i.test(key);
      const rendered = numberText(value, locale, rate ? 6 : 2);
      return [key, `${rendered.approximate ? '≈ ' : ''}${rendered.text}`];
    }),
  );
}

export interface FormulaLabels {
  maximum: string;
  lookup: string;
  amount: string;
}

/** Formats mathematical text without evaluating it or inferring a tax rule. */
export function formatFeeFormula(
  line: CalculationLine,
  currency: string,
  locale: string,
  labels: FormulaLabels,
): string {
  const result = numberText(line.amount, locale, 2).text;
  const table = /^clearance_band\(([^)]+)\)\s*=/.exec(line.formula);
  if (table && numeric.test(table[1])) {
    const value = numberText(table[1], locale, 2);
    return `${labels.lookup}(${value.approximate ? '≈ ' : ''}${value.text}) = ${result} ${currency}`;
  }
  if (new Set(['0', '0.00', 'round(0)', 'round2(round2(0))']).has(line.formula))
    return `${labels.amount} = ${result} ${currency}`;
  let approximate = false;
  let expression = line.formula
    .replace(/round2?\(/g, '(')
    .replace(/max\(/g, `${labels.maximum}(`)
    .replace(/,\s*/g, ' ; ')
    .replace(/\d+(?:\.\d+)?/g, (value) => {
      const parsed = new Amount(value);
      // Preserve small coefficients; shorten long monetary operands for readability.
      const displayed = numberText(value, locale, parsed.abs().lt(10) ? 6 : 2);
      approximate ||= displayed.approximate;
      return displayed.text;
    });
  while (expression.startsWith('(') && expression.endsWith(')')) {
    let depth = 0;
    let enclosing = true;
    for (let i = 0; i < expression.length - 1; i++) {
      if (expression[i] === '(') depth++;
      if (expression[i] === ')') depth--;
      if (depth === 0) {
        enclosing = false;
        break;
      }
    }
    if (!enclosing) break;
    expression = expression.slice(1, -1);
  }
  return `${approximate ? '≈ ' : ''}${expression} = ${result} ${currency}`;
}
