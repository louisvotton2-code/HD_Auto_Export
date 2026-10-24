/**
 * Facts transcribed from the public RU reference calculator, captured 2026-10-23:
 * https://www.kmotors.shop/en/calculator
 * Public resource: /_next/static/chunks/294c5dc095472cc4.js
 *
 * These are reference coefficients, not officially verified recycling rates or
 * proof that a personal-use concession applies. The applicable base is 20,000 RUB.
 * Each upper power boundary is inclusive; null denotes the unbounded final row.
 */
export interface RecyclingBand {
  maxHp: number | null;
  fresh: string;
  aged: string;
}

export const RECYCLING_UP_TO_1000: readonly RecyclingBand[] = [
  { maxHp: 190, fresh: '15.36', aged: '28.44' },
  { maxHp: 220, fresh: '15.84', aged: '29.28' },
  { maxHp: null, fresh: '17.28', aged: '30.12' },
];

export const RECYCLING_UP_TO_2000: readonly RecyclingBand[] = [
  { maxHp: 190, fresh: '45', aged: '74.64' },
  { maxHp: 220, fresh: '47.64', aged: '79.2' },
  { maxHp: 250, fresh: '50.52', aged: '83.88' },
  { maxHp: 280, fresh: '57.12', aged: '91.92' },
  { maxHp: 310, fresh: '64.56', aged: '100.56' },
  { maxHp: 340, fresh: '72.96', aged: '110.16' },
  { maxHp: 370, fresh: '83.16', aged: '120.6' },
  { maxHp: 400, fresh: '94.8', aged: '132' },
  { maxHp: 430, fresh: '108', aged: '144.6' },
  { maxHp: 460, fresh: '123.24', aged: '158.4' },
  { maxHp: 490, fresh: '140.4', aged: '173.4' },
  { maxHp: null, fresh: '160.08', aged: '189.84' },
];

export const RECYCLING_UP_TO_3000: readonly RecyclingBand[] = [
  { maxHp: 190, fresh: '115.33', aged: '172.8' },
  { maxHp: 220, fresh: '118.2', aged: '175.08' },
  { maxHp: 250, fresh: '120.12', aged: '177.6' },
  { maxHp: 280, fresh: '126', aged: '183' },
  { maxHp: 310, fresh: '131.04', aged: '188.52' },
  { maxHp: 340, fresh: '136.32', aged: '193.68' },
  { maxHp: 370, fresh: '141.72', aged: '199.08' },
  { maxHp: 400, fresh: '147.48', aged: '204.72' },
  { maxHp: 430, fresh: '153.36', aged: '210.48' },
  { maxHp: null, fresh: '153.36', aged: '228.6' },
];

export const RECYCLING_UP_TO_3500: readonly RecyclingBand[] = [
  { maxHp: 160, fresh: '129.2', aged: '197.81' },
  { maxHp: 190, fresh: '131.76', aged: '200.04' },
  { maxHp: 220, fresh: '134.4', aged: '202.2' },
  { maxHp: 250, fresh: '137.16', aged: '204.36' },
  { maxHp: 280, fresh: '140.52', aged: '207.24' },
  { maxHp: 310, fresh: '144', aged: '212.4' },
  { maxHp: 340, fresh: '151.92', aged: '217.8' },
  { maxHp: 370, fresh: '160.32', aged: '224.28' },
  { maxHp: 400, fresh: '169.2', aged: '231' },
  { maxHp: null, fresh: '178.44', aged: '237.96' },
];

export const RECYCLING_OVER_3500: readonly RecyclingBand[] = [
  { maxHp: 160, fresh: '164.53', aged: '216.29' },
  { maxHp: 190, fresh: '167.28', aged: '219.48' },
  { maxHp: 220, fresh: '170.16', aged: '222.84' },
  { maxHp: 250, fresh: '173.04', aged: '226.2' },
  { maxHp: 280, fresh: '176.52', aged: '231.36' },
  { maxHp: 310, fresh: '180', aged: '236.64' },
  { maxHp: 340, fresh: '186.36', aged: '249.6' },
  { maxHp: 370, fresh: '192.88', aged: '263.4' },
  { maxHp: 400, fresh: '199.68', aged: '277.92' },
  { maxHp: 430, fresh: '206.64', aged: '293.16' },
  { maxHp: null, fresh: '206.64', aged: '309.36' },
];

export const RECYCLING_ELECTRIC: readonly RecyclingBand[] = [
  { maxHp: 100, fresh: '49.56', aged: '82.08' },
  { maxHp: 130, fresh: '65.88', aged: '95.64' },
  { maxHp: 160, fresh: '78', aged: '111.36' },
  { maxHp: 190, fresh: '92.4', aged: '129.72' },
  { maxHp: 220, fresh: '109.68', aged: '151.2' },
  { maxHp: 250, fresh: '129.96', aged: '176.16' },
  { maxHp: 280, fresh: '153.96', aged: '205.2' },
  { maxHp: null, fresh: '182.4', aged: '239.04' },
];
