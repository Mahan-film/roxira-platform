import retentionConfig from './data/retention-clocks.v1.json';

export type DeRetentionClassCode =
  | 'ledgers_and_statements'
  | 'accounting_vouchers'
  | 'commercial_correspondence';

export interface DeRetentionRule {
  code: DeRetentionClassCode;
  label: string;
  years: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUrl: string;
  verified: boolean;
  notes: string;
}

const RULES: readonly DeRetentionRule[] = retentionConfig.classes as DeRetentionRule[];

/**
 * Resolve the effective-dated German statutory retention rule for a document class
 * on a given ISO date (`YYYY-MM-DD`).
 */
export function resolveDeRetentionRule(
  code: DeRetentionClassCode,
  asOfDate: string,
): DeRetentionRule {
  const match = RULES.find(
    (r) =>
      r.code === code &&
      r.effectiveFrom <= asOfDate &&
      (r.effectiveTo === null || asOfDate <= r.effectiveTo),
  );
  if (!match) {
    throw new Error(`No DE retention rule found for class=${code} on date=${asOfDate}`);
  }
  return match;
}

export function listDeRetentionRules(): readonly DeRetentionRule[] {
  return RULES;
}
