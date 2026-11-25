import {
  DEFAULT_PACK_CODE,
  DEFAULT_PACK_REMUNERATION_CATALOG,
  SYNTHETIC_DEFAULT_PACK_PAYSLIP_LINES,
} from './default-pack.remuneration.fixture';
import {
  PayrollExecutionProvider,
  PayrollExecutionProviderRegistry,
} from './payroll-execution-provider.interface';
import {
  CanonicalRemunerationCode,
  RemunerationCategory,
  assertBankTotalMatchesPayslips,
  summarizeRemunerationLines,
} from './remuneration-taxonomy';

describe('Canonical remuneration taxonomy & PayrollExecutionProvider (T260 / #1055)', () => {
  it('default-pack catalog has unique canonical codes, valid effective dates, and statutory deductions prioritized before voluntary deductions', () => {
    const codes = DEFAULT_PACK_REMUNERATION_CATALOG.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);

    for (const spec of DEFAULT_PACK_REMUNERATION_CATALOG) {
      expect(spec.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(spec.deductionPriority).toBeGreaterThanOrEqual(0);
    }

    const tax = DEFAULT_PACK_REMUNERATION_CATALOG.find(
      (c) => c.code === CanonicalRemunerationCode.INCOME_TAX,
    )!;
    const empIns = DEFAULT_PACK_REMUNERATION_CATALOG.find(
      (c) => c.code === CanonicalRemunerationCode.SOCIAL_INSURANCE_EMPLOYEE,
    )!;
    const loan = DEFAULT_PACK_REMUNERATION_CATALOG.find(
      (c) => c.code === CanonicalRemunerationCode.LOAN_REPAYMENT,
    )!;
    expect(tax.deductionPriority).toBeGreaterThan(0);
    expect(tax.deductionPriority).toBeLessThan(loan.deductionPriority);
    expect(empIns.deductionPriority).toBeLessThan(loan.deductionPriority);
  });

  it('summarizes synthetic default-pack payslip lines in exact bigint minor units', () => {
    const summary = summarizeRemunerationLines(SYNTHETIC_DEFAULT_PACK_PAYSLIP_LINES, 'IRR');

    expect(summary.currency).toBe('IRR');
    expect(summary.grossEarningsMinor).toBe(12_500_000_00n);
    expect(summary.totalEmployeeDeductionsMinor).toBe(2_375_000_00n);
    expect(summary.totalEmployerContributionsMinor).toBe(2_500_000_00n);
    expect(summary.retroDeltaMinor).toBe(0n);
    expect(summary.netPayMinor).toBe(10_125_000_00n);
  });

  it('handles signed retro deltas and rejects mixed currencies or negative earnings', () => {
    const withRetro = summarizeRemunerationLines([
      ...SYNTHETIC_DEFAULT_PACK_PAYSLIP_LINES,
      {
        componentCode: CanonicalRemunerationCode.RETRO_EARNING_DELTA,
        category: RemunerationCategory.RETRO_DELTA,
        amountMinor: -125_000_00n,
        currency: 'IRR',
        validFrom: '2026-02-20',
        validTo: '2026-03-20',
        recordedAt: '2026-04-20T12:00:00.000Z',
        retroSourcePayrunId: 'payrun-prev-1',
      },
    ]);
    expect(withRetro.retroDeltaMinor).toBe(-125_000_00n);
    expect(withRetro.netPayMinor).toBe(10_000_000_00n);

    expect(() =>
      summarizeRemunerationLines([
        {
          componentCode: CanonicalRemunerationCode.BASE_SALARY,
          category: RemunerationCategory.EARNING,
          amountMinor: 100n,
          currency: 'EUR',
          validFrom: '2026-03-21',
          validTo: '2026-04-20',
          recordedAt: '2026-04-20T12:00:00.000Z',
        },
      ], 'IRR'),
    ).toThrow(/Mixed currencies/);

    expect(() =>
      summarizeRemunerationLines([
        {
          componentCode: CanonicalRemunerationCode.BASE_SALARY,
          category: RemunerationCategory.EARNING,
          amountMinor: -1n,
          currency: 'IRR',
          validFrom: '2026-03-21',
          validTo: '2026-04-20',
          recordedAt: '2026-04-20T12:00:00.000Z',
        },
      ]),
    ).toThrow(/Negative EARNING/);
  });

  it('enforces exact minor-unit equality between net payslips and bank file totals', () => {
    expect(() =>
      assertBankTotalMatchesPayslips([10_125_000_00n, 5_000_000_00n], 15_125_000_00n),
    ).not.toThrow();

    expect(() =>
      assertBankTotalMatchesPayslips([10_125_000_00n, 5_000_000_00n], 15_125_000_01n),
    ).toThrow(/Bank payment total/);
  });

  it('PayrollExecutionProviderRegistry resolves registered native & partner providers and fails closed on unknown packs', () => {
    const makeStubProvider = (
      providerId: string,
      packCode: string,
      mode: 'native' | 'partner_handoff',
    ): PayrollExecutionProvider => ({
      providerId,
      packCode,
      mode,
      supportsRetroDelta: true,
      supportedComponentCodes: new Set(DEFAULT_PACK_REMUNERATION_CATALOG.map((c) => c.code)),
      validateInputs: async () => ({ valid: true, issues: [] }),
      executePayrun: async (ctx) => ({
        providerId,
        packCode,
        payrunId: ctx.payrunId,
        mode,
        currency: ctx.currency,
        calculatedAt: ctx.evaluationDate,
        employees: [],
        totalNetPayMinor: 0n,
        totalEmployerCostMinor: 0n,
        glPostingLines: [],
      }),
    });

    const nativeDefault = makeStubProvider('native-default', DEFAULT_PACK_CODE, 'native');
    const partnerDatev = makeStubProvider('datev-lohn-datenservices', 'de', 'partner_handoff');
    const registry = new PayrollExecutionProviderRegistry([nativeDefault, partnerDatev]);

    expect(registry.resolveForPack(DEFAULT_PACK_CODE)).toBe(nativeDefault);
    expect(registry.resolveForPack('DE')).toBe(partnerDatev);
    expect(registry.resolveById('datev-lohn-datenservices')).toBe(partnerDatev);
    expect(registry.listRegisteredPacks()).toEqual(['de', 'default']);

    // Fail closed on unknown pack or provider id
    expect(() => registry.resolveForPack('unknown-pack')).toThrow(/No PayrollExecutionProvider/);
    expect(() => registry.resolveById('unknown-id')).toThrow(/No PayrollExecutionProvider/);

    // Reject duplicate registrations
    expect(() => registry.register(nativeDefault)).toThrow(/Duplicate PayrollExecutionProvider/);
  });
});
