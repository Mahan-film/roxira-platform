import type { ContractTerm, ContractTerms } from '../../hr/statutory/contract-terms';
import { advanceRecovery, computeDeductions, insuranceOf, percentOf, requireRate, termUse, UnclearTermError } from './deductions';

const term = (over: Partial<ContractTerm> = {}): ContractTerm => ({
  key: 'contract_retention_rate', rate: '0.1', unclear: false, verified: false, version: 1, effectiveFrom: '2026-03-21', source: 's', tenantOverride: false, ...over,
});

describe('requireRate', () => {
  it('scales a known rate to 6 decimals', () => {
    expect(requireRate(term())).toBe(100_000n);
    expect(requireRate(term({ rate: '0.07' }))).toBe(70_000n);
  });
  it('refuses an unclear term, naming it, and never reads null as zero', () => {
    const unclear = term({ key: 'contract_advance_payment_max_rate', rate: null, unclear: true });
    expect(() => requireRate(unclear)).toThrow(UnclearTermError);
    expect(() => requireRate(unclear)).toThrow('سقف پیش‌پرداخت قرارداد');
    expect(() => requireRate(term({ rate: null }))).toThrow(UnclearTermError);
  });
});

describe('percent math (minor units, half up)', () => {
  it('10% of 40,000,000,000 minor (400,000,000 rial) is 4,000,000,000', () => {
    expect(percentOf(40_000_000_000n, 100_000n)).toBe(4_000_000_000n);
  });
  it('rounds half up: 5% of 30 minor = 1.5 -> 2, of 29 -> 1.45 -> 1', () => {
    expect(percentOf(30n, 50_000n)).toBe(2n);
    expect(percentOf(29n, 50_000n)).toBe(1n);
  });
  it('insurance 7% with addon 0.1 on 40,000,000,000 is 40e9 x 0.077 = 3,080,000,000', () => {
    expect(insuranceOf(40_000_000_000n, 70_000n, 100_000n)).toBe(3_080_000_000n);
  });
});

describe('advanceRecovery', () => {
  // advance 100,000,000 on a 1,000,000,000 contract, in minor x100 below
  const A = 10_000_000_000n;
  const C = 100_000_000_000n;
  it('follows cumulative work: 30% then 70% then 100% recovers 30m, 40m, 30m', () => {
    const r1 = advanceRecovery(A, C, 30_000_000_000n, 0n, 30_000_000_000n);
    const r2 = advanceRecovery(A, C, 70_000_000_000n, r1, 40_000_000_000n);
    const r3 = advanceRecovery(A, C, 100_000_000_000n, r1 + r2, 30_000_000_000n);
    expect([r1, r2, r3]).toEqual([3_000_000_000n, 4_000_000_000n, 3_000_000_000n]);
    expect(r1 + r2 + r3).toBe(A);
  });
  it('is 0 without an advance, and never above the period', () => {
    expect(advanceRecovery(0n, C, 30_000_000_000n, 0n, 30_000_000_000n)).toBe(0n);
    expect(advanceRecovery(A, C, 90_000_000_000n, 0n, 1_000n)).toBe(1_000n);
  });
});

describe('termUse', () => {
  it('marks an organisation figure as its own, never as verified legal fact', () => {
    expect(termUse(term({ verified: true, tenantOverride: true })).legalFact).toBe(false);
    expect(termUse(term({ verified: true })).legalFact).toBe(true);
    expect(termUse(term({ verified: false })).legalFact).toBe(false);
  });
});

describe('computeDeductions', () => {
  const T = (rate: string | null, key: ContractTerm['key'], over: Partial<ContractTerm> = {}): ContractTerm => term({ key, rate, unclear: rate === null, ...over });
  const terms = (over: Partial<ContractTerms> = {}): ContractTerms => ({
    asOf: '2026-11-01',
    retention: T('0.1', 'contract_retention_rate'),
    insuranceDeposit: T('0.05', 'contract_insurance_deposit_rate'),
    insuranceByType: {
      MECHANICAL: T('0.07', 'contract_insurance_rate_mechanical'), NON_MECHANICAL: T('0.15', 'contract_insurance_rate_non_mechanical'),
      CIVIL_EXECUTIVE: T(null, 'contract_insurance_rate_civil_executive'), CIVIL_CONSULTING: T(null, 'contract_insurance_rate_civil_consulting'),
    },
    unemploymentAddon: T('0.1', 'contract_unemployment_addon_fraction', { tenantOverride: true }),
    taxWithholding: T(null, 'contract_tax_withholding_rate'),
    advancePaymentMax: T(null, 'contract_advance_payment_max_rate'),
    ...over,
  });
  const base = { period: 40_000_000_000n, cumulative: 70_000_000_000n, contractAmount: 100_000_000_000n, advancePosted: 0n, advanceRecovered: 0n };

  it('statement 2 of a 1,000,000,000 contract: period 400m -> retention 40m, mechanical insurance 30.8m', () => {
    const d = computeDeductions({ ...base, insuranceType: 'MECHANICAL', terms: terms() });
    expect([d.retention, d.insurance, d.advance]).toEqual([4_000_000_000n, 3_080_000_000n, 0n]);
    expect(d.used.map((u) => [u.key, u.legalFact])).toEqual([
      ['contract_retention_rate', false], ['contract_insurance_rate_mechanical', false], ['contract_unemployment_addon_fraction', false],
    ]);
  });
  it('no insurance type means no insurance deduction and needs no insurance figure', () => {
    const d = computeDeductions({ ...base, insuranceType: null, terms: terms({ unemploymentAddon: T(null, 'contract_unemployment_addon_fraction') }) });
    expect(d.insurance).toBe(0n);
  });
  it('an unclear figure blocks: civil executive rate, unemployment addon, or retention', () => {
    expect(() => computeDeductions({ ...base, insuranceType: 'CIVIL_EXECUTIVE', terms: terms() })).toThrow('ضریب بیمه پیمان عمرانی اجرایی');
    expect(() => computeDeductions({ ...base, insuranceType: 'MECHANICAL', terms: terms({ unemploymentAddon: T(null, 'contract_unemployment_addon_fraction') }) })).toThrow('کسر بیمه بیکاری');
    expect(() => computeDeductions({ ...base, insuranceType: null, terms: terms({ retention: T(null, 'contract_retention_rate') }) })).toThrow('سپرده حسن انجام کار');
  });
});
