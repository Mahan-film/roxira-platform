import 'reflect-metadata';
import { buildContractTerms } from './contract-terms';
import { resolveParameters } from './statutory.service';
import { StatutoryParameterEntity, StatutorySourceKind } from './statutory-parameter.entity';

const T1 = '11111111-1111-4111-8111-111111111111';

const row = (
  paramKey: string,
  value: unknown,
  over: Partial<StatutoryParameterEntity> = {},
): StatutoryParameterEntity => ({
  id: `${paramKey}-${over.effectiveFrom ?? 'a'}-${over.version ?? 1}`,
  tenantId: null,
  country: 'IR',
  fiscalYear: 1405,
  paramKey,
  effectiveFrom: '2026-03-21',
  version: 1,
  value,
  unclear: value === null,
  source: 'test',
  sourceKind: StatutorySourceKind.REPORT,
  verified: false,
  createdBy: 'test',
  createdAt: new Date(0),
  ...over,
});

describe('buildContractTerms', () => {
  const rows = [
    row('contract_retention_rate', '0.1'),
    row('contract_insurance_rate_mechanical', '0.07'),
    row('contract_tax_withholding_rate', null),
  ];

  it('returns a known rate as a decimal string and an unclear one as null', () => {
    const terms = buildContractTerms('2026-06-01', resolveParameters(rows, '2026-06-01'));
    expect(terms.retention).toMatchObject({ rate: '0.1', unclear: false, verified: false, tenantOverride: false });
    expect(terms.insuranceByType.MECHANICAL.rate).toBe('0.07');
    expect(terms.taxWithholding).toMatchObject({ rate: null, unclear: true });
  });

  it('reports a key with no row at all as unclear, never as zero', () => {
    const terms = buildContractTerms('2026-06-01', resolveParameters(rows, '2026-06-01'));
    expect(terms.advancePaymentMax).toMatchObject({ rate: null, unclear: true, version: 0 });
    expect(terms.insuranceByType.CIVIL_EXECUTIVE.rate).toBeNull();
  });

  it('lets a tenant row replace an unclear platform default', () => {
    const tenant = row('contract_tax_withholding_rate', '0.03', {
      tenantId: T1,
      verified: true,
      sourceKind: StatutorySourceKind.TENANT,
    });
    const terms = buildContractTerms('2026-06-01', resolveParameters([...rows, tenant], '2026-06-01'));
    expect(terms.taxWithholding).toMatchObject({ rate: '0.03', unclear: false, verified: true, tenantOverride: true });
  });

  it('ignores versions that take effect after the date asked for', () => {
    const later = row('contract_retention_rate', '0.05', { effectiveFrom: '2026-09-23', version: 2 });
    const terms = buildContractTerms('2026-06-01', resolveParameters([...rows, later], '2026-06-01'));
    expect(terms.retention.rate).toBe('0.1');
    const after = buildContractTerms('2026-10-01', resolveParameters([...rows, later], '2026-10-01'));
    expect(after.retention.rate).toBe('0.05');
  });
});

describe('payroll rates ignore contract terms', () => {
  it('keeps contract keys out of unverifiedKeys and refuses an unclear required key', () => {
    const { seededRows } = jest.requireActual('./__fixtures__/seeded-rates');
    const base: StatutoryParameterEntity[] = seededRows(1405);
    const withContract = [...base, row('contract_retention_rate', '0.1'), row('contract_tax_withholding_rate', null)];
    const { toPayrollRates } = jest.requireActual('./statutory.service');
    const rates = toPayrollRates(1405, resolveParameters(withContract, '2026-12-31'));
    expect(rates.unverifiedKeys.some((k: string) => k.startsWith('contract_'))).toBe(false);
    const broken = [...base.filter((r) => r.paramKey !== 'housing_allowance'), row('housing_allowance', null)];
    expect(() => toPayrollRates(1405, resolveParameters(broken, '2026-12-31'))).toThrow(/حق مسکن/);
  });
});
