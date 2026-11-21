import { BadRequestException } from '@nestjs/common';
import { BudgetControlService } from './budget-control.service';

describe('BudgetControlService.checkAndEncumberPo (lock and fail-closed)', () => {
  const TENANT = '00000000-0000-4000-8000-000000000001';
  const input = { accountCode: '6100', costCenterCode: 'CC1', periodKey: '2026-11', sourceId: 'PO-1', amountMinor: 100n };

  function build(budgetRows: unknown[]) {
    const calls: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes('fin_account_budgets')) return budgetRows;
        if (sql.includes('fin_journal_entry_lines')) return [{ spend: '0' }];
        if (sql.includes('SUM("amount_minor")')) return [{ committed: '0' }];
        return [];
      }),
    };
    const scope = { within: async (_t: string, _m: unknown, fn: (m: unknown) => Promise<unknown>) => fn(manager) };
    const service = new BudgetControlService(scope as never, {} as never);
    return { service, calls };
  }

  it('takes the advisory lock before reading the budget', async () => {
    const { service, calls } = build([{ budget_amount: '1000.00' }]);
    await service.checkAndEncumberPo(TENANT, input);
    expect(calls[0]).toContain('pg_advisory_xact_lock');
    expect(calls.findIndex((c) => c.includes('INSERT INTO "fin_budget_encumbrances"'))).toBeGreaterThan(0);
  });

  it('rejects when no budget row exists and writes nothing', async () => {
    const { service, calls } = build([]);
    await expect(service.checkAndEncumberPo(TENANT, input)).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.some((c) => c.includes('INSERT INTO'))).toBe(false);
  });
});
