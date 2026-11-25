// effective-dated, source-linked: update here only
//
// Single home of the default-pack rate rules loaded by TaxEngineService at startup.
// Rates are integer basis points. Every rule needs a `source` (URL or citation).
// Persisting rules in a DB table (tenant scoped, migration) is out of scope for T180.
import { TaxRateRule } from './tax-engine.types';

const VAT_ACT_SOURCE = 'Default-pack VAT act and annual rate schedule (citation to be confirmed by tax counsel)';

export const DEFAULT_PACK_TAX_RULES: readonly TaxRateRule[] = [
  { code: 'IR_VAT_9', country: 'IR', treatment: 'STANDARD', rateBps: 900, effectiveFrom: '2015-03-21', effectiveTo: '2024-03-19', outputBox: 'IR_VAT_STD', inputBox: 'IR_VAT_IN', source: VAT_ACT_SOURCE },
  { code: 'IR_VAT_10', country: 'IR', treatment: 'STANDARD', rateBps: 1000, effectiveFrom: '2024-03-20', effectiveTo: null, outputBox: 'IR_VAT_STD', inputBox: 'IR_VAT_IN', source: VAT_ACT_SOURCE },
  { code: 'IR_EXEMPT', country: 'IR', treatment: 'EXEMPT', rateBps: 0, effectiveFrom: '2000-01-01', effectiveTo: null, outputBox: 'IR_VAT_EXEMPT', inputBox: null, source: VAT_ACT_SOURCE },
];
