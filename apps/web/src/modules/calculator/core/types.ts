export type CountryCode = 'RU' | 'KZ' | 'UZ' | 'GE' | 'AM' | 'KG' | 'AL';
export type ImporterType = 'individual' | 'company';
export type Powertrain = 'petrol' | 'diesel' | 'hev' | 'phev' | 'erev' | 'bev';
export type TransactionCurrency = 'CNY' | 'USD';

/** Empty strings represent facts the user has not supplied, never a zero value. */
export interface CalculationInput {
  country: CountryCode;
  importerType: ImporterType;
  powertrain: Powertrain;
  price: string;
  currency: TransactionCurrency;
  displacementCc: string;
  powerHp: string;
  manufactureDate: string;
  customsDate: string;
  freight: string;
  insurance: string;
  steering: 'left' | 'right';
  /** Destination currency per one unit of the transaction currency. */
  transactionRate: string;
  /** Destination currency per one EUR. */
  euroRate: string;
  /** Destination currency per USD; needed for UZ's USD tariff base. */
  usdRate?: string;
  /** UZ distinguishes never-registered new cars from used cars. */
  condition?: 'new' | 'used';
}

export interface CalculationLine {
  id: string;
  amount: string;
  /** A human-readable mathematical expression, without localized prose. */
  formula: string;
  /** Policy-selected explanation and actual operands; language is supplied by UI. */
  method?: {
    key: string;
    params: Record<string, string | number>;
  };
}

export interface CalculationExtraLine extends CalculationLine {
  kind: 'one_time_estimate' | 'annual';
}

export interface ReferencePolicyFacts {
  input: CalculationInput;
  ageMonths: number;
  ageYears: number;
}

export interface ReferencePolicyResult {
  lines: CalculationLine[];
  additionalCosts: CalculationExtraLine[];
}

/** Status and diagnostic codes are presentation independent; the UI translates them. */
export interface CalculationResult {
  status: 'incomplete' | 'invalid' | 'needs_review' | 'reference';
  currency: string;
  lines: CalculationLine[];
  total: string | null;
  missingFields: string[];
  fieldErrors: Record<string, string>;
  reason: string | null;
  ruleVersion: string | null;
  quality: 'reference_only';
  excludedCosts: string[];
  additionalCosts: CalculationExtraLine[];
  assumptions: string[];
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}
