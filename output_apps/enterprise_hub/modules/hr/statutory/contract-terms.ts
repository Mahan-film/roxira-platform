import { StatutoryKey } from './statutory-catalogue';
import { StatutoryParameterEntity } from './statutory-parameter.entity';

/** Contract kinds the social-security coefficient depends on (Social Security Org. circular 14). */
export const CONTRACT_INSURANCE_TYPES = [
  'MECHANICAL',
  'NON_MECHANICAL',
  'CIVIL_EXECUTIVE',
  'CIVIL_CONSULTING',
] as const;
export type ContractInsuranceType = (typeof CONTRACT_INSURANCE_TYPES)[number];

/** Store key per contract kind. */
export const INSURANCE_KEY_BY_TYPE: Record<ContractInsuranceType, StatutoryKey> = {
  MECHANICAL: 'contract_insurance_rate_mechanical',
  NON_MECHANICAL: 'contract_insurance_rate_non_mechanical',
  CIVIL_EXECUTIVE: 'contract_insurance_rate_civil_executive',
  CIVIL_CONSULTING: 'contract_insurance_rate_civil_consulting',
};

export const CONTRACT_TERM_KEYS: StatutoryKey[] = [
  'contract_retention_rate',
  'contract_insurance_deposit_rate',
  ...Object.values(INSURANCE_KEY_BY_TYPE),
  'contract_unemployment_addon_fraction',
  'contract_tax_withholding_rate',
  'contract_advance_payment_max_rate',
];

/**
 * One contract figure. `rate` is a decimal string such as "0.05", or null when `unclear`: callers
 * must treat null as "unknown, ask a person", never as zero.
 */
export interface ContractTerm {
  key: StatutoryKey;
  rate: string | null;
  unclear: boolean;
  verified: boolean;
  version: number;
  effectiveFrom: string;
  source: string;
  tenantOverride: boolean;
}

export interface ContractTerms {
  asOf: string;
  retention: ContractTerm;
  insuranceDeposit: ContractTerm;
  insuranceByType: Record<ContractInsuranceType, ContractTerm>;
  unemploymentAddon: ContractTerm;
  taxWithholding: ContractTerm;
  advancePaymentMax: ContractTerm;
}

const missing = (key: StatutoryKey): ContractTerm => ({
  key,
  rate: null,
  unclear: true,
  verified: false,
  version: 0,
  effectiveFrom: '',
  source: 'پارامتر در پایگاه تعریف نشده است',
  tenantOverride: false,
});

/** Builds the T3 view from the rows already resolved for `asOf`. Pure, so it is unit-testable. */
export function buildContractTerms(
  asOf: string,
  resolved: Map<StatutoryKey, StatutoryParameterEntity>,
): ContractTerms {
  const term = (key: StatutoryKey): ContractTerm => {
    const row = resolved.get(key);
    if (!row) {
      return missing(key);
    }
    const unclear = row.unclear || row.value === null || row.value === undefined;
    return {
      key,
      rate: unclear ? null : String(row.value),
      unclear,
      verified: row.verified && !unclear,
      version: row.version,
      effectiveFrom: row.effectiveFrom.slice(0, 10),
      source: row.source,
      tenantOverride: row.tenantId !== null,
    };
  };
  return {
    asOf,
    retention: term('contract_retention_rate'),
    insuranceDeposit: term('contract_insurance_deposit_rate'),
    insuranceByType: {
      MECHANICAL: term(INSURANCE_KEY_BY_TYPE.MECHANICAL),
      NON_MECHANICAL: term(INSURANCE_KEY_BY_TYPE.NON_MECHANICAL),
      CIVIL_EXECUTIVE: term(INSURANCE_KEY_BY_TYPE.CIVIL_EXECUTIVE),
      CIVIL_CONSULTING: term(INSURANCE_KEY_BY_TYPE.CIVIL_CONSULTING),
    },
    unemploymentAddon: term('contract_unemployment_addon_fraction'),
    taxWithholding: term('contract_tax_withholding_rate'),
    advancePaymentMax: term('contract_advance_payment_max_rate'),
  };
}
