import { describe, expect, it } from 'vitest';
import { formatDecimalInput, formatDisplayAmount } from './display-amount';

describe('decimal display', () => {
  it('displays two places for rates without mutating the editable value', () => {
    const rate = '81.969182';
    expect(formatDecimalInput(rate, 2)).toBe('81.97');
    expect(formatDecimalInput('94.7', 2)).toBe('94.70');
    expect(formatDecimalInput('', 2)).toBe('');
    expect(formatDecimalInput('81.', 2)).toBe('81.');
    expect(rate).toBe('81.969182');
  });

  it('rounds vehicle prices to integers without rounding through cents first', () => {
    expect(formatDisplayAmount('12000.499', 'en', 0, 0)).toBe('12,000');
    expect(formatDisplayAmount('12000.500', 'en', 0, 0)).toBe('12,001');
    expect(formatDisplayAmount('9007199254740993.999', 'en', 0, 0)).toBe('9,007,199,254,740,994');
  });

  it('keeps two places on fee amounts with the selected locale separator', () => {
    expect(formatDisplayAmount('12000', 'en', 2)).toBe('12,000.00');
    expect(formatDisplayAmount('120.1', 'ru', 2)).toBe('120,10');
    expect(formatDisplayAmount('1.995', 'en', 2)).toBe('2.00');
  });
});
