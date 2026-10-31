import { requireModulePermission } from '../../access/access-context';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { McpToolsService } from '../../../mcp/mcp-tools.service';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { PipelineStage } from '../../crm/enums/crm.enums';
import { QueryStockItemDto } from '../../inventory/dto/query-stock-item.dto';
import { InventoryService } from '../../inventory/services/inventory.service';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import { InvoiceSummaryRow } from '../../invoicing/repositories/invoicing.repository';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import {
  requireTenantId,
} from '../../tenants/tenant-context';
import { ASSISTANT_MAX_ROWS } from '../constants/assistant.constants';
import { ASSISTANT_PERIODS, resolvePeriod } from './jalali-period';

/** تعریف ابزار به قالب function-calling سازگار با OpenAI/OpenRouter. */
export interface AssistantToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

type ToolArgs = Record<string, unknown>;
type ToolHandler = (
  request: AuthenticatedRequest,
  args: ToolArgs,
) => Promise<unknown>;

const PERIOD_PROPERTIES = {
  period: {
    type: 'string',
    enum: [...ASSISTANT_PERIODS],
    description:
      'Named Jalali (Iranian calendar) period. this_month/last_month are Jalali months. Default this_month.',
  },
  from: {
    type: 'string',
    description:
      'Optional explicit start date, Jalali (1405/07/01) or Gregorian (2026-09-23). Overrides period.',
  },
  to: {
    type: 'string',
    description: 'Optional explicit end date (inclusive), Jalali or Gregorian.',
  },
};

const SEARCH_LIMIT_PROPERTIES = {
  search: { type: 'string', description: 'Optional search text.' },
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: ASSISTANT_MAX_ROWS,
    description: `Max rows (default 20, max ${ASSISTANT_MAX_ROWS}).`,
  },
};

/** ابزارهای فقط‌خواندنی دستیار. هیچ ابزاری `tenantId` ورودی نمی‌گیرد. */
export const ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'invoicing_sales_summary',
      description:
        'Sales totals from issued and paid invoices in a period, per currency (count, total payable, VAT). Use for "sales last month", "revenue this year".',
      parameters: {
        type: 'object',
        properties: PERIOD_PROPERTIES,
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'invoicing_customer_balance',
      description:
        'Outstanding receivable (issued, unpaid invoices) and paid totals for one customer, matched by buyer name, per currency.',
      parameters: {
        type: 'object',
        properties: {
          customer: {
            type: 'string',
            description: 'Customer (buyer) name or part of it.',
          },
          ...PERIOD_PROPERTIES,
          period: { ...PERIOD_PROPERTIES.period, description: 'Default all.' },
        },
        required: ['customer'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inventory_low_stock',
      description:
        'Stock items at or below their minimum quantity (reorder level).',
      parameters: {
        type: 'object',
        properties: SEARCH_LIMIT_PROPERTIES,
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inventory_list_items',
      description:
        'Search stock items with total quantity, minimum quantity and FIFO value (IRR).',
      parameters: {
        type: 'object',
        properties: SEARCH_LIMIT_PROPERTIES,
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inventory_list_warehouses',
      description: 'List warehouses (id, name, location).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inventory_warehouse_stock',
      description: 'Stock of one warehouse per item, with total value.',
      parameters: {
        type: 'object',
        properties: {
          warehouseId: { type: 'integer', description: 'Warehouse id.' },
        },
        required: ['warehouseId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crm_list_leads',
      description:
        'Search CRM customers/leads (name, company, phone, pipeline stage, estimated value).',
      parameters: {
        type: 'object',
        properties: {
          ...SEARCH_LIMIT_PROPERTIES,
          stage: { type: 'string', enum: Object.values(PipelineStage) },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'accounting_trial_balance',
      description:
        'Trial balance of the general ledger: per account debit, credit, balance.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'accounting_account_ledger',
      description: 'Movements and closing balance of one ledger account by code.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Account code.' },
          limit: { type: 'integer', minimum: 1, maximum: ASSISTANT_MAX_ROWS },
        },
        required: ['code'],
        additionalProperties: false,
      },
    },
  },
];

function optionalString(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`آرگومان ${key} باید متن باشد.`);
  }
  return value.trim().slice(0, 120) || undefined;
}

function rowLimit(args: ToolArgs): number {
  const parsed = Math.trunc(Number(args.limit ?? 20));
  if (!Number.isFinite(parsed)) {
    return 20;
  }
  return Math.min(Math.max(parsed, 1), ASSISTANT_MAX_ROWS);
}

function positiveInt(args: ToolArgs, key: string): number {
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException(`آرگومان ${key} باید عدد صحیح مثبت باشد.`);
  }
  return value;
}

/** جمع ردیف‌های خلاصه به تفکیک ارز. */
function byCurrency(
  rows: InvoiceSummaryRow[],
): Array<{ currency: string; count: number; total: number; tax: number }> {
  const totals = new Map<
    string,
    { currency: string; count: number; total: number; tax: number }
  >();
  for (const row of rows) {
    const current = totals.get(row.currency) ?? {
      currency: row.currency,
      count: 0,
      total: 0,
      tax: 0,
    };
    current.count += row.count;
    current.total += row.total;
    current.tax += row.tax;
    totals.set(row.currency, current);
  }
  return [...totals.values()];
}

/**
 * ابزارهای فقط‌خواندنی دستیار هوشمند روی داده‌های خود سازمان.
 *
 * - شناسه مستأجر «تنها» از پیلود تأییدشده JWT خوانده می‌شود
 *   (`requireTenantId`)؛ هیچ ابزاری آرگومان مستأجر ندارد و آرگومان‌های اضافه
 *   نادیده گرفته می‌شوند (Rule #4 - AGENTS.md).
 * - هر ابزار از سرویس ماژول مالک یا ابزار MCP موجود (#807) استفاده می‌کند؛
 *   مدل هیچ SQL خامی نمی‌سازد (Rule #3).
 * - دسترسی‌ها همانند REST: صورتحساب و حسابداری فقط برای مدیر/مالک سازمان.
 */
/** Tool name prefix -> the module whose data the tool exposes. */
const TOOL_MODULES: Record<string, AccessModule> = {
  invoicing: AccessModule.INVOICING,
  inventory: AccessModule.INVENTORY,
  crm: AccessModule.CRM,
  accounting: AccessModule.ACCOUNTING,
  hr: AccessModule.HR,
};

@Injectable()
export class AssistantToolsService {
  private readonly handlers: Record<string, ToolHandler>;

  constructor(
    private readonly mcpTools: McpToolsService,
    private readonly invoicingService: InvoicingService,
    private readonly inventoryService: InventoryService,
  ) {
    this.handlers = {
      invoicing_sales_summary: (request, args) =>
        this.salesSummary(request, args),
      invoicing_customer_balance: (request, args) =>
        this.customerBalance(request, args),
      inventory_low_stock: (request, args) => this.lowStock(request, args),
      inventory_list_items: (request, args) => this.listItems(request, args),
      inventory_list_warehouses: (request) => this.listWarehouses(request),
      inventory_warehouse_stock: (request, args) =>
        this.mcpTools.inventoryStock(request, {
          warehouseId: positiveInt(args, 'warehouseId'),
        }),
      crm_list_leads: (request, args) => this.listLeads(request, args),
      accounting_trial_balance: (request) =>
        this.mcpTools.accountingTrialBalance(request),
      accounting_account_ledger: (request, args) => {
        const code = optionalString(args, 'code');
        if (!code) {
          throw new BadRequestException('کد حساب لازم است.');
        }
        return this.mcpTools.accountingAccountLedger(request, {
          code,
          limit: rowLimit(args),
        });
      },
    };
  }

  /** فهرست تعریف ابزارها برای ارسال به مدل. */
  definitions(): AssistantToolDefinition[] {
    return ASSISTANT_TOOLS;
  }

  /** آیا ابزاری با این نام وجود دارد؟ */
  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.handlers, name);
  }

  /**
   * اجرای یک ابزار با مستأجر کاربر احراز‌هویت‌شده. خطاهای HTTP (دسترسی،
   * ورودی نامعتبر، یافت‌نشدن) به‌صورت `{ error }` برای مدل برمی‌گردند.
   */
  async run(
    request: AuthenticatedRequest,
    name: string,
    args: ToolArgs,
  ): Promise<{ ok: boolean; result: unknown }> {
    requireTenantId(request);
    if (!this.has(name)) {
      return { ok: false, result: { error: `ابزار ناشناخته: ${name}` } };
    }
    try {
      // Each tool reads one module's data: the caller needs that module's read permission.
      requireModulePermission(request, TOOL_MODULES[name.split('_')[0]] ?? AccessModule.ASSISTANT, AccessAction.READ);
      return { ok: true, result: await this.handlers[name](request, args) };
    } catch (error) {
      if (error instanceof HttpException) {
        return { ok: false, result: { error: error.message } };
      }
      throw error;
    }
  }

  private async salesSummary(
    request: AuthenticatedRequest,
    args: ToolArgs,
  ): Promise<unknown> {
    const tenantId = requireTenantId(request);
    const range = resolvePeriod({
      period: optionalString(args, 'period'),
      from: optionalString(args, 'from'),
      to: optionalString(args, 'to'),
    });
    const rows = await this.invoicingService.summarize(tenantId, {
      statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PAID],
      from: range.from,
      to: range.to,
    });
    return {
      period: range.label,
      from: range.from?.toISOString() ?? null,
      to: range.to?.toISOString() ?? null,
      byCurrency: byCurrency(rows),
      note: 'Amounts are in each invoice currency (IRR = rial). Drafts and cancelled invoices are excluded.',
    };
  }

  private async customerBalance(
    request: AuthenticatedRequest,
    args: ToolArgs,
  ): Promise<unknown> {
    const tenantId = requireTenantId(request);
    const customer = optionalString(args, 'customer');
    if (!customer) {
      throw new BadRequestException('نام مشتری لازم است.');
    }
    const range = resolvePeriod({
      period: optionalString(args, 'period') ?? 'all',
      from: optionalString(args, 'from'),
      to: optionalString(args, 'to'),
    });
    const rows = await this.invoicingService.summarize(tenantId, {
      statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PAID],
      from: range.from,
      to: range.to,
      buyerSearch: customer,
    });
    return {
      customer,
      period: range.label,
      outstanding: byCurrency(
        rows.filter((row) => row.status === InvoiceStatus.ISSUED),
      ),
      paid: byCurrency(rows.filter((row) => row.status === InvoiceStatus.PAID)),
      note: 'outstanding = issued but unpaid invoices whose buyer name matches.',
    };
  }

  private async lowStock(
    request: AuthenticatedRequest,
    args: ToolArgs,
  ): Promise<unknown> {
    const tenantId = requireTenantId(request);
    const page = await this.inventoryService.listStockItems(tenantId, {
      page: 1,
      limit: rowLimit(args),
      search: optionalString(args, 'search'),
      lowStockOnly: true,
    } as QueryStockItemDto);
    return {
      total: page.total,
      items: page.data.map((item) => ({
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        minQuantity: item.minQuantity,
        shortage: Math.max(item.minQuantity - item.quantity, 0),
      })),
    };
  }

  private async listItems(
    request: AuthenticatedRequest,
    args: ToolArgs,
  ): Promise<unknown> {
    const page = await this.mcpTools.inventoryListItems(request, {
      search: optionalString(args, 'search'),
      limit: rowLimit(args),
    });
    return {
      total: page.total,
      lowStockCount: page.lowStockCount,
      items: page.data.map((item) => ({
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        minQuantity: item.minQuantity,
        isLowStock: item.isLowStock,
        fifoValuationIrr: item.fifoValuation,
      })),
    };
  }

  private async listWarehouses(request: AuthenticatedRequest): Promise<unknown> {
    const tenantId = requireTenantId(request);
    const warehouses = await this.inventoryService.listWarehouses(tenantId);
    return warehouses.slice(0, ASSISTANT_MAX_ROWS);
  }

  private async listLeads(
    request: AuthenticatedRequest,
    args: ToolArgs,
  ): Promise<unknown> {
    const stage = optionalString(args, 'stage');
    if (stage && !Object.values<string>(PipelineStage).includes(stage)) {
      throw new BadRequestException(`مرحله نامعتبر: ${stage}`);
    }
    const page = await this.mcpTools.crmListLeads(request, {
      search: optionalString(args, 'search'),
      limit: rowLimit(args),
      stage: stage as PipelineStage | undefined,
    });
    return {
      total: page.total,
      leads: page.data.map((lead) => ({
        id: lead.id,
        fullName: lead.fullName,
        company: lead.company,
        phone: lead.phone,
        pipelineStage: lead.pipelineStage,
        estimatedValue: lead.estimatedValue,
      })),
    };
  }
}
