/** Internal import compatibility; the implementation and public facade stay in the pure core. */
export {
  calculateManufactureRange,
  isManufactureMonthRange,
  MAX_MANUFACTURE_RANGE_MONTHS,
} from '../core/manufacture-range';
export type {
  ManufactureMonthRange,
  ManufactureRangeCalculation,
  ManufactureQuoteScenario,
} from '../core/manufacture-range';
