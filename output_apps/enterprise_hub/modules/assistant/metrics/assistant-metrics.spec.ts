import 'reflect-metadata';
import { requestWithAccess } from '../../../test/support/access-stub';
import { UserRole } from '../../auth/enums/user-role.enum';
import { TenantRole } from '../../tenants/enums/tenant-role.enum';
import { AssistantMetricsService } from './assistant-metrics.service';
import { METRIC_IDS, METRIC_REGISTRY } from './metric-registry';
import { MetricSources } from './metric.types';

const TENANT = 'tenant-a';
const owner = requestWithAccess({
  role: UserRole.USER,
  tenantId: TENANT,
  tenantRole: TenantRole.OWNER,
});
const member = requestWithAccess({
  role: UserRole.USER,
  tenantId: TENANT,
  tenantRole: TenantRole.MEMBER,
});
const noTenant = requestWithAccess({ role: UserRole.USER });

/** 1405/08/13 (آبان) = 2026-11-04؛ فصل سوم ۱۴۰۵. */
const NOW = new Date('2026-11-04T09:00:00.000Z');

function fixtureSources(): jest.Mocked<MetricSources> {
  return {
    dashboard: jest.fn().mockResolvedValue({
      cash: 150_000_000,
      bank: 850_000_000,
      receivables: 420_000_000,
      payables: 300_000_000,
      taxDue: 40_000_000,
      inventory: 700_000_000,
    }),
    incomeStatement: jest.fn().mockResolvedValue({
      revenue: 2_000_000_000,
      grossProfit: 500_000_000,
      operatingExpenses: 200_000_000,
      netProfit: 300_000_000,
    }),
    balanceSheet: jest.fn().mockResolvedValue({
      totalAssets: 3_000_000_000,
      totalLiabilities: 1_200_000_000,
      totalEquity: 1_800_000_000,
    }),
    ageing: jest.fn().mockImplementation(async (_t, side) => ({
      buckets: [{ fromDay: 0 }, { fromDay: 31 }, { fromDay: 61 }, { fromDay: 91 }],
      amounts:
        side === 'receivable'
          ? [200_000_000, 100_000_000, 70_000_000, 50_000_000]
          : [150_000_000, 90_000_000, 60_000_000, 0],
    })),
    // ماه جاری از 2026-10-23 شروع می‌شود (۱ آبان ۱۴۰۵).
    salesTotals: jest.fn().mockImplementation(async (_t, range) =>
      range.from.getTime() >= new Date('2026-10-22T00:00:00Z').getTime()
        ? { count: 12, payable: 600_000_000, vat: 54_545_454 }
        : { count: 10, payable: 500_000_000, vat: 45_454_545 },
    ),
    stock: jest
      .fn()
      .mockResolvedValue({ fifoValue: 710_000_000, lowStockCount: 4 }),
    chequesDue: jest.fn().mockResolvedValue({
      receivedTotal: 80_000_000,
      issuedTotal: 35_000_000,
      overdueCount: 2,
    }),
    payrollRun: jest.fn().mockResolvedValue({
      employeeCount: 5,
      totalGross: 250_000_000,
      totalEmployerInsurance: 50_000_000,
    }),
    vatSeason: jest
      .fn()
      .mockResolvedValue({ payable: 12_345_678, reconciled: true }),
  };
}

describe('metric registry', () => {
  it('has about 25 uniquely identified, documented metrics', () => {
    expect(METRIC_REGISTRY.length).toBeGreaterThanOrEqual(25);
    expect(new Set(METRIC_IDS).size).toBe(METRIC_IDS.length);
    for (const metric of METRIC_REGISTRY) {
      expect(metric.id).toMatch(/^[a-z0-9_]+$/);
      expect(metric.labelFa).toMatch(/[؀-ۿ]/);
      expect(metric.definitionFa).toMatch(/[؀-ۿ]/);
      expect(['IRR', 'count', 'percent']).toContain(metric.unit);
    }
  });
});

describe('AssistantMetricsService on fixture data', () => {
  let sources: jest.Mocked<MetricSources>;
  let service: AssistantMetricsService;

  beforeEach(() => {
    sources = fixtureSources();
    service = new AssistantMetricsService(sources);
  });

  const valueOf = async (id: string) => {
    const out = await service.run(owner, id, NOW);
    if (!out.ok) {
      throw new Error(out.error);
    }
    return out.result.value;
  };

  const expected: Record<string, number> = {
    cash_balance: 150_000_000,
    bank_balance: 850_000_000,
    liquid_funds: 1_000_000_000,
    receivables: 420_000_000,
    payables: 300_000_000,
    // اقلام بالاتر از ۳۰ روز: 100+70+50 میلیون
    overdue_receivables: 220_000_000,
    overdue_payables: 150_000_000,
    sales_this_month: 600_000_000,
    sales_last_month: 500_000_000,
    sales_change_pct: 20,
    invoice_count_this_month: 12,
    vat_collected_this_month: 54_545_454,
    revenue_ytd: 2_000_000_000,
    gross_profit_ytd: 500_000_000,
    gross_margin_pct: 25,
    operating_expenses_ytd: 200_000_000,
    net_profit_ytd: 300_000_000,
    total_assets: 3_000_000_000,
    total_liabilities: 1_200_000_000,
    total_equity: 1_800_000_000,
    vat_payable_season: 12_345_678,
    stock_value: 710_000_000,
    below_reorder_count: 4,
    payroll_cost_this_month: 300_000_000,
    cheques_due_7d_received: 80_000_000,
    cheques_due_7d_issued: 35_000_000,
    cheques_overdue_count: 2,
  };

  it('has a spec value for every registered metric', () => {
    expect(Object.keys(expected).sort()).toEqual([...METRIC_IDS].sort());
  });

  it.each(Object.entries(expected))('%s = %p', async (id, value) => {
    expect(await valueOf(id)).toBe(value);
  });

  it('asks the VAT draft for the current Jalali season of the Jalali year', async () => {
    await valueOf('vat_payable_season');
    expect(sources.vatSeason).toHaveBeenCalledWith(TENANT, 1405, 3);
  });

  it('asks payroll for the current Jalali month', async () => {
    await valueOf('payroll_cost_this_month');
    expect(sources.payrollRun).toHaveBeenCalledWith(TENANT, 1405, 8);
  });

  it('uses the Tehran calendar day for as-of dates', async () => {
    await service.run(owner, 'cash_balance', new Date('2026-11-04T21:00:00Z'));
    expect(sources.dashboard).toHaveBeenCalledWith(TENANT, '2026-11-05');
  });

  describe('abstains instead of guessing', () => {
    it('no sales last month: percent change is undefined', async () => {
      sources.salesTotals.mockImplementation(async (_t, range) =>
        range.from.getTime() >= new Date('2026-10-22T00:00:00Z').getTime()
          ? { count: 1, payable: 100, vat: 9 }
          : { count: 0, payable: 0, vat: 0 },
      );
      const out = await service.run(owner, 'sales_change_pct', NOW);
      expect(out).toMatchObject({ ok: true, result: { value: null } });
      expect(out.ok && out.result.reasonFa).toMatch(/ماه گذشته/);
    });

    it('no revenue: gross margin is undefined', async () => {
      sources.incomeStatement.mockResolvedValue({
        revenue: 0,
        grossProfit: 0,
        operatingExpenses: 0,
        netProfit: 0,
      });
      expect(await valueOf('gross_margin_pct')).toBeNull();
    });

    it('no payroll run this month', async () => {
      sources.payrollRun.mockResolvedValue(null);
      expect(await valueOf('payroll_cost_this_month')).toBeNull();
    });

    it('VAT draft that does not reconcile with the ledger is not reported', async () => {
      sources.vatSeason.mockResolvedValue({ payable: 5, reconciled: false });
      expect(await valueOf('vat_payable_season')).toBeNull();
    });
  });

  describe('tenant isolation and permissions', () => {
    it('uses only the tenant of the JWT, whatever else is passed', async () => {
      const hostile = requestWithAccess({
        role: UserRole.USER,
        tenantId: TENANT,
        tenantRole: TenantRole.OWNER,
      });
      Object.assign(hostile, { query: { tenantId: 'tenant-b' }, body: { tenantId: 'tenant-b' } });
      for (const id of METRIC_IDS) {
        await service.run(hostile, id, NOW);
      }
      for (const mock of Object.values(sources)) {
        for (const call of mock.mock.calls) {
          expect(call[0]).toBe(TENANT);
        }
      }
    });

    it('throws without a tenant and never touches a source', async () => {
      await expect(service.run(noTenant, 'cash_balance', NOW)).rejects.toThrow();
      expect(sources.dashboard).not.toHaveBeenCalled();
    });

    it('a plain member does not read the ledger or payroll', async () => {
      const ledger = await service.run(member, 'cash_balance', NOW);
      const payroll = await service.run(member, 'payroll_cost_this_month', NOW);
      expect(ledger.ok).toBe(false);
      expect(payroll.ok).toBe(false);
      expect(sources.dashboard).not.toHaveBeenCalled();
      expect(sources.payrollRun).not.toHaveBeenCalled();
    });

    it('unknown metric id is an error, not a query', async () => {
      const out = await service.run(owner, 'DROP TABLE users', NOW);
      expect(out.ok).toBe(false);
      for (const mock of Object.values(sources)) {
        expect(mock).not.toHaveBeenCalled();
      }
    });
  });

  it('only declares read methods on its sources (no write path)', () => {
    const names = Object.keys(sources);
    expect(names.filter((name) => /^(post|create|update|delete|save)/.test(name))).toEqual([]);
  });
});
