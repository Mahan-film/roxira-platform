import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { AccountType } from '../../accounting/enums/accounting.enum';
import { ProfitabilityService } from './profitability.service';

const T = '11111111-1111-4111-8111-111111111111';
const project = (over: Record<string, unknown> = {}) => ({ id: 1, code: 'P1', name: 'پروژه', costCentreCode: 'CC-1', budget: '1000000000.00', ...over });

function build(projects: any[], totals: Map<number, { billed: bigint; subcontracts: bigint }>, centre: () => Promise<any>) {
  const projectRepo: any = { list: jest.fn(async () => ({ rows: projects, total: projects.length })), findById: jest.fn(async () => projects[0] ?? null) };
  const statements: any = { postedTotalsByProject: jest.fn(async () => totals) };
  const costCentres: any = { trialBalance: jest.fn(centre) };
  const reports: any = { accounts: jest.fn(async () => [{ code: '5201', accountType: AccountType.EXPENSE }, { code: '4101', accountType: AccountType.REVENUE }]) };
  return new ProfitabilityService(projectRepo, statements, costCentres, reports);
}
const row = (code: string, debit: bigint, credit: bigint) => ({ code, periodDebit: debit, periodCredit: credit });

describe('ProfitabilityService', () => {
  it('budget 1,000,000,000; billed 800,000,000; subcontracts 300,000,000; ledger expense 200,000,000 (5201 debit 250m, credit 50m; revenue ignored)', async () => {
    const totals = new Map([[1, { billed: 80_000_000_000n, subcontracts: 30_000_000_000n }]]);
    const svc = build([project()], totals, async () => ({ centres: [{ code: 'CC-1', rows: [row('5201', 25_000_000_000n, 5_000_000_000n), row('4101', 0n, 99_000_000_000n)] }] }));
    const { projects } = await svc.report(T, {});
    expect(projects[0]).toMatchObject({
      budget: 1000000000, billed: 800000000, actual: { subcontracts: 300000000, ledger: 200000000, total: 500000000 },
      budgetRemaining: 500000000, margin: 300000000, ledgerLinked: true,
    });
  });
  it('a project without a cost centre, or with an unknown one, has a null ledger part, not 0', async () => {
    const none = build([project({ costCentreCode: null })], new Map(), async () => { throw new Error('not called'); });
    expect((await none.report(T, {})).projects[0]).toMatchObject({ ledgerLinked: false, actual: { ledger: null, total: 0 } });
    const unknown = build([project()], new Map(), async () => { throw new NotFoundException('x'); });
    expect((await unknown.report(T, {})).projects[0].ledgerLinked).toBe(false);
  });
  it('refuses a reversed range', async () => {
    await expect(build([], new Map(), async () => ({})).report(T, { from: '2026-12-01', to: '2026-11-01' })).rejects.toThrow('بعد از');
  });
});
