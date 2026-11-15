import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { requestWithAccess } from '../../test/support/access-stub';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import { AssistantMetricsService } from './metrics/assistant-metrics.service';
import {
  ASSISTANT_TOOLS,
  AssistantToolsService,
} from './services/assistant-tools.service';

const requestWith = (user: Record<string, unknown>): AuthenticatedRequest =>
  requestWithAccess(user);

const TENANT_ID = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const owner = requestWith({
  role: UserRole.USER,
  tenantId: TENANT_ID,
  tenantRole: TenantRole.OWNER,
});
const member = requestWith({
  role: UserRole.USER,
  tenantId: TENANT_ID,
  tenantRole: TenantRole.MEMBER,
});
const noTenant = requestWith({ role: UserRole.USER });

/** تلاش مدل برای تزریق مستأجر دیگر در آرگومان‌ها. */
const HOSTILE = { tenantId: OTHER_TENANT, tenant_id: OTHER_TENANT };

describe('AssistantToolsService (tenant scoping)', () => {
  const mcpTools = {
    inventoryStock: jest.fn().mockResolvedValue({ rows: [] }),
    accountingTrialBalance: jest.fn().mockResolvedValue({ rows: [] }),
    accountingAccountLedger: jest.fn().mockResolvedValue({ entries: [] }),
    inventoryListItems: jest
      .fn()
      .mockResolvedValue({ data: [], total: 0, lowStockCount: 0 }),
    crmListLeads: jest.fn().mockResolvedValue({ data: [], total: 0 }),
  };
  const invoicingService = { summarize: jest.fn().mockResolvedValue([]) };
  const inventoryService = {
    listStockItems: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    listWarehouses: jest.fn().mockResolvedValue([]),
  };
  const metricSources = {
    dashboard: jest.fn().mockResolvedValue({
      cash: 150, bank: 850, receivables: 1, payables: 1, taxDue: 0, inventory: 0,
    }),
  };
  const financialReports = {
    incomeStatement: jest.fn().mockResolvedValue({
      revenue: { total: 100_000_000_00n },
      costOfSales: { total: 40_000_000_00n },
      grossProfit: 60_000_000_00n,
      operatingExpenses: { total: 15_000_000_00n },
      operatingProfit: 45_000_000_00n,
      netProfit: 40_000_000_00n,
    }),
  };
  const structureService = {
    listBranches: jest.fn().mockResolvedValue([
      { id: 'branch-central', name: 'شعبه مرکزی', code: 'CENTRAL' },
      { id: 'branch-west', name: 'شعبه غرب', code: 'WEST' },
    ]),
  };
  const service = new AssistantToolsService(
    mcpTools as never,
    invoicingService as never,
    inventoryService as never,
    new AssistantMetricsService(metricSources as never),
    financialReports as never,
    structureService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('no tool definition accepts a tenant argument', () => {
    for (const tool of ASSISTANT_TOOLS) {
      const props = Object.keys(
        (tool.function.parameters.properties ?? {}) as object,
      );
      expect(props.some((key) => /tenant/i.test(key))).toBe(false);
    }
  });

  it('every defined tool has a handler', () => {
    for (const tool of ASSISTANT_TOOLS) {
      expect(service.has(tool.function.name)).toBe(true);
    }
  });

  it('refuses every tool for a user without a tenant', async () => {
    for (const tool of ASSISTANT_TOOLS) {
      await expect(
        service.run(noTenant, tool.function.name, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('invoicing_sales_summary uses the JWT tenant, issued+paid, and period bounds', async () => {
    invoicingService.summarize.mockResolvedValueOnce([
      { currency: 'IRR', status: InvoiceStatus.ISSUED, count: 2, total: 100, tax: 10 },
      { currency: 'IRR', status: InvoiceStatus.PAID, count: 1, total: 50, tax: 5 },
    ]);
    const out = await service.run(owner, 'invoicing_sales_summary', {
      ...HOSTILE,
      period: 'last_month',
    });
    expect(out.ok).toBe(true);
    const [tenant, options] = invoicingService.summarize.mock.calls[0];
    expect(tenant).toBe(TENANT_ID);
    expect(options.statuses).toEqual([InvoiceStatus.ISSUED, InvoiceStatus.PAID]);
    expect(options.from).toBeInstanceOf(Date);
    expect(options.to).toBeInstanceOf(Date);
    expect((out.result as { byCurrency: unknown }).byCurrency).toEqual([
      { currency: 'IRR', count: 3, total: 150, tax: 15 },
    ]);
  });

  it('invoicing_customer_balance uses the JWT tenant and splits outstanding/paid', async () => {
    invoicingService.summarize.mockResolvedValueOnce([
      { currency: 'IRR', status: InvoiceStatus.ISSUED, count: 1, total: 70, tax: 7 },
      { currency: 'IRR', status: InvoiceStatus.PAID, count: 1, total: 30, tax: 3 },
    ]);
    const out = await service.run(owner, 'invoicing_customer_balance', {
      ...HOSTILE,
      customer: 'آلفا',
    });
    const [tenant, options] = invoicingService.summarize.mock.calls[0];
    expect(tenant).toBe(TENANT_ID);
    expect(options.buyerSearch).toBe('آلفا');
    expect(options.from).toBeUndefined();
    const result = out.result as { outstanding: unknown; paid: unknown };
    expect(result.outstanding).toEqual([
      { currency: 'IRR', count: 1, total: 70, tax: 7 },
    ]);
    expect(result.paid).toEqual([{ currency: 'IRR', count: 1, total: 30, tax: 3 }]);
  });

  it('invoicing tools are admin-only, like the REST controller', async () => {
    for (const name of ['invoicing_sales_summary', 'invoicing_customer_balance']) {
      const out = await service.run(member, name, { customer: 'x' });
      expect(out.ok).toBe(false);
    }
    expect(invoicingService.summarize).not.toHaveBeenCalled();
  });

  it('inventory_low_stock uses the JWT tenant and lowStockOnly', async () => {
    inventoryService.listStockItems.mockResolvedValueOnce({
      data: [{ sku: 'A', name: 'پیچ', quantity: 2, minQuantity: 10 }],
      total: 1,
    });
    const out = await service.run(owner, 'inventory_low_stock', {
      ...HOSTILE,
      limit: 999,
    });
    expect(inventoryService.listStockItems).toHaveBeenCalledWith(TENANT_ID, {
      page: 1,
      limit: 50,
      search: undefined,
      lowStockOnly: true,
    });
    expect((out.result as { items: unknown[] }).items).toEqual([
      { sku: 'A', name: 'پیچ', quantity: 2, minQuantity: 10, shortage: 8 },
    ]);
  });

  it('inventory_list_warehouses uses the JWT tenant', async () => {
    await service.run(owner, 'inventory_list_warehouses', HOSTILE);
    expect(inventoryService.listWarehouses).toHaveBeenCalledWith(TENANT_ID);
  });

  it('MCP-backed tools receive the authenticated request, never a tenant argument', async () => {
    const cases: Array<[string, Record<string, unknown>, jest.Mock]> = [
      ['inventory_list_items', { search: 'x' }, mcpTools.inventoryListItems],
      ['inventory_warehouse_stock', { warehouseId: 3 }, mcpTools.inventoryStock],
      ['crm_list_leads', { search: 'x' }, mcpTools.crmListLeads],
      ['accounting_trial_balance', {}, mcpTools.accountingTrialBalance],
      ['accounting_account_ledger', { code: '1101' }, mcpTools.accountingAccountLedger],
    ];
    for (const [name, args, mock] of cases) {
      const out = await service.run(owner, name, { ...args, ...HOSTILE });
      expect(out.ok).toBe(true);
      expect(mock).toHaveBeenCalledTimes(1);
      const [request, input] = mock.mock.calls[0];
      expect(request).toBe(owner);
      expect(JSON.stringify(input ?? {})).not.toContain(OTHER_TENANT);
    }
  });

  it('returns tool errors to the model instead of throwing', async () => {
    mcpTools.accountingTrialBalance.mockRejectedValueOnce(
      new ForbiddenException('دسترسی مدیریتی سازمان لازم است.'),
    );
    const out = await service.run(owner, 'accounting_trial_balance', {});
    expect(out).toEqual({
      ok: false,
      result: { error: 'دسترسی مدیریتی سازمان لازم است.' },
    });
  });

  it('a legacy member only gets the modules their role has (no inventory, no accounting)', async () => {
    for (const name of ['inventory_low_stock', 'inventory_list_items', 'accounting_trial_balance']) {
      const out = await service.run(member, name, {});
      expect(out.ok).toBe(false);
    }
    expect(inventoryService.listStockItems).not.toHaveBeenCalled();
  });

  it('rejects unknown tools', async () => {
    const out = await service.run(owner, 'sql_query', { sql: 'select 1' });
    expect(out.ok).toBe(false);
  });

  it('rejects bad arguments without calling services', async () => {
    const out = await service.run(owner, 'inventory_warehouse_stock', {
      warehouseId: 'abc',
    });
    expect(out.ok).toBe(false);
    expect(mcpTools.inventoryStock).not.toHaveBeenCalled();
  });

  it('assistant_metric returns a certified metric for the JWT tenant only', async () => {
    const out = await service.run(owner, 'assistant_metric', { id: 'cash_balance', ...HOSTILE });
    expect(out).toMatchObject({ ok: true, result: { id: 'cash_balance', value: 150, unit: 'IRR' } });
    expect(metricSources.dashboard.mock.calls[0][0]).toBe(TENANT_ID);
  });

  it('assistant_metric rejects unknown ids and never builds queries from them', async () => {
    const out = await service.run(owner, 'assistant_metric', { id: "1; DROP TABLE x" });
    expect(out.ok).toBe(false);
    expect(metricSources.dashboard).not.toHaveBeenCalled();
  });

  it('assistant_metric is limited to modules the caller may read', async () => {
    const out = await service.run(member, 'assistant_metric', { id: 'cash_balance' });
    expect(out.ok).toBe(false);
    expect(metricSources.dashboard).not.toHaveBeenCalled();
  });

  it('the metric tool lists every certified metric and takes no tenant or SQL argument', () => {
    const tool = ASSISTANT_TOOLS.find((t) => t.function.name === 'assistant_metric');
    expect(tool).toBeDefined();
    const properties = (tool?.function.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties)).toEqual(['id']);
  });

  describe('profit(from, to) tool and Persian golden eval', () => {
    it('profit tool definition exists and takes no tenant argument', () => {
      const tool = ASSISTANT_TOOLS.find((t) => t.function.name === 'profit');
      expect(tool).toBeDefined();
      const props = Object.keys(
        (tool?.function.parameters as { properties: Record<string, unknown> }).properties,
      );
      expect(props.some((k) => /tenant/i.test(k))).toBe(false);
      expect(props).toContain('period');
      expect(props).toContain('from');
      expect(props).toContain('to');
      expect(props).toContain('branchName');
    });

    it('runs profit tool with JWT tenant and returns structured financial figures and source fields', async () => {
      const out = await service.run(owner, 'profit', {
        period: 'this_month',
        ...HOSTILE,
      });
      expect(out.ok).toBe(true);
      const res = out.result as any;
      expect(res.source_record_id).toContain('income-statement:');
      expect(res.revenue).toBe(100000000);
      expect(res.grossProfit).toBe(60000000);
      expect(res.grossProfitToman).toBe(6000000);
      expect(res.operatingProfit).toBe(45000000);
      expect(res.netProfit).toBe(40000000);
      expect(res.source_fields.grossProfit).toEqual({
        source_record_id: res.source_record_id,
        field_path: 'grossProfit',
        value: 60000000,
      });
      expect(financialReports.incomeStatement).toHaveBeenCalledWith(TENANT_ID, expect.any(Object));
    });

    it('resolves branchName against allowed branches and rejects unknown branches', async () => {
      const out = await service.run(owner, 'profit', {
        branchName: 'شعبه مرکزی',
      });
      expect(out.ok).toBe(true);

      const badOut = await service.run(owner, 'profit', {
        branchName: 'شعبه ناموجود',
      });
      expect(badOut.ok).toBe(false);
    });

    it('refuses profit for member without accounting permission', async () => {
      const out = await service.run(member, 'profit', {});
      expect(out.ok).toBe(false);
    });

    // --- 10 Persian golden eval test cases (day, month, custom range) ---
    const goldenQuestions = [
      {
        id: 1,
        type: 'day',
        question: 'سود امروز شرکت چقدر است؟',
        args: { period: 'today' },
        expectedMatch: 'امروز',
      },
      {
        id: 2,
        type: 'day',
        question: 'سود دیروز چقدر بود؟',
        args: { period: 'yesterday' },
        expectedMatch: 'دیروز',
      },
      {
        id: 3,
        type: 'month',
        question: 'سود این ماه را گزارش بده',
        args: { period: 'this_month' },
        expectedMatch: 'ماه',
      },
      {
        id: 4,
        type: 'month',
        question: 'سود ماه گذشته چقدر بوده است؟',
        args: { period: 'last_month' },
        expectedMatch: 'ماه',
      },
      {
        id: 5,
        type: 'month',
        question: 'سود ماه مهر چقدر بود؟',
        args: { from: '1405/07/01', to: '1405/07/30' },
        expectedMatch: '1405/07/01 تا 1405/07/30',
      },
      {
        id: 6,
        type: 'month',
        question: 'سود از ابتدای آبان تا الان چقدر بوده است؟',
        args: { from: '1405/08/01', to: '1405/08/24' },
        expectedMatch: '1405/08/01 تا 1405/08/24',
      },
      {
        id: 7,
        type: 'custom_range',
        question: 'سود سه‌ماهه اول سال را محاسبه کن',
        args: { from: '1405/01/01', to: '1405/03/31' },
        expectedMatch: '1405/01/01 تا 1405/03/31',
      },
      {
        id: 8,
        type: 'custom_range',
        question: 'سود در بازه تابستان ۱۴۰۵/۰۴/۰۱ تا ۱۴۰۵/۰۶/۳۱ چقدر است؟',
        args: { from: '1405/04/01', to: '1405/06/31' },
        expectedMatch: '1405/04/01 تا 1405/06/31',
      },
      {
        id: 9,
        type: 'custom_range',
        question: 'سود دوره 2026-04-01 تا 2026-06-30 چقدر است؟',
        args: { from: '2026-04-01', to: '2026-06-30' },
        expectedMatch: '2026-04-01 تا 2026-06-30',
      },
      {
        id: 10,
        type: 'year_to_date',
        question: 'سود کل از ابتدای سال مالی تا امروز چقدر است؟',
        args: { period: 'this_year' },
        expectedMatch: 'سال',
      },
    ];

    goldenQuestions.forEach((q) => {
      it(`Golden Eval #${q.id} (${q.type}): "${q.question}"`, async () => {
        const out = await service.run(owner, 'profit', q.args);
        expect(out.ok).toBe(true);
        const res = out.result as any;
        expect(res.period).toContain(q.expectedMatch);
        expect(res.revenue).toBe(100000000);
        expect(res.grossProfit).toBe(60000000);
        expect(res.netProfit).toBe(40000000);
        expect(res.source_record_id).toBeDefined();
        expect(res.source_fields.grossProfit.value).toBe(60000000);
        expect(res.source_fields.netProfit.value).toBe(40000000);
      });
    });
  });
});
