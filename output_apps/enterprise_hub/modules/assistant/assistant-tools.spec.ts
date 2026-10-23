import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import { TenantRole } from '../tenants/enums/tenant-role.enum';
import {
  ASSISTANT_TOOLS,
  AssistantToolsService,
} from './services/assistant-tools.service';

const requestWith = (user: unknown): AuthenticatedRequest =>
  ({ user }) as unknown as AuthenticatedRequest;

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
  const service = new AssistantToolsService(
    mcpTools as never,
    invoicingService as never,
    inventoryService as never,
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
    const out = await service.run(member, 'inventory_low_stock', {
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
    await service.run(member, 'inventory_list_warehouses', HOSTILE);
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
    const out = await service.run(member, 'accounting_trial_balance', {});
    expect(out).toEqual({
      ok: false,
      result: { error: 'دسترسی مدیریتی سازمان لازم است.' },
    });
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
});
