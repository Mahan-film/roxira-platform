import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { AuthenticatedRequest } from '../modules/auth/guards/jwt-auth.guard';
import { PipelineStage } from '../modules/crm/enums/crm.enums';
import { McpServer, McpToolResult, StreamableHTTPServerTransport, z } from './mcp-sdk';
import { McpToolsService } from './mcp-tools.service';

/**
 * نقطه اتصال پروتکل MCP (Model Context Protocol) به ماژول‌های سازمانی.
 *
 * برای هر درخواست HTTP یک سرور MCP تازه (stateless) ساخته می‌شود که ابزارهای
 * آن به همان درخواست احراز‌هویت‌شده گره خورده‌اند؛ بنابراین شناسه مستأجر تنها از
 * پیلود JWT تأییدشده خوانده می‌شود و مرزهای سازمانی بین درخواست‌ها حفظ می‌گردد.
 * انتقال از نوع Streamable HTTP است.
 */
@Injectable()
export class McpHttpHandler {
  constructor(private readonly tools: McpToolsService) {}

  /** مدیریت یک درخواست MCP روی انتقال Streamable HTTP بدون session. */
  async handle(
    request: AuthenticatedRequest,
    response: Response,
  ): Promise<void> {
    const server = this.createServer(request);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    response.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  }

  /** پاسخ استاندارد خطای JSON-RPC برای متدهای غیرمجاز در حالت stateless. */
  static methodNotAllowed(): {
    jsonrpc: '2.0';
    error: { code: number; message: string };
    id: null;
  } {
    return {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    };
  }

  private ok(data: unknown): McpToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  }

  private fail(error: unknown): McpToolResult {
    const message =
      error instanceof Error ? error.message : 'خطای نامشخص در اجرای ابزار.';
    return { content: [{ type: 'text', text: message }], isError: true };
  }

  /** اجرای یک ابزار با تبدیل خطا به نتیجه MCP بدون شکست کل درخواست. */
  private run(
    handler: () => unknown | Promise<unknown>,
  ): Promise<McpToolResult> {
    return Promise.resolve()
      .then(handler)
      .then((data) => this.ok(data))
      .catch((error) => this.fail(error));
  }

  private createServer(request: AuthenticatedRequest): any {
    const server = new McpServer({
      name: 'roxira-enterprise-hub',
      version: '1.0.0',
    });

    server.registerTool(
      'crm_list_leads',
      {
        title: 'CRM: فهرست سرنخ‌ها',
        description:
          'فهرست صفحه‌بندی‌شده سرنخ‌های فروش با جست‌وجو و فیلتر مرحله (حداکثر ۱۰۰ ردیف).',
        inputSchema: {
          search: z.string().optional(),
          stage: z.enum(Object.values(PipelineStage)).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async (args: any) => this.run(() => this.tools.crmListLeads(request, args)),
    );

    server.registerTool(
      'crm_get_lead',
      {
        title: 'CRM: دریافت سرنخ',
        description: 'دریافت یک سرنخ بر اساس شناسه.',
        inputSchema: { id: z.number().int().positive() },
      },
      async (args: any) => this.run(() => this.tools.crmGetLead(request, args)),
    );

    server.registerTool(
      'hr_list_employees',
      {
        title: 'HR: فهرست پرسنل',
        description: 'فهرست پرسنل با جست‌وجو (فقط دسترسی مدیریتی، حداکثر ۱۰۰ ردیف).',
        inputSchema: {
          search: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async (args: any) =>
        this.run(() => this.tools.hrListEmployees(request, args)),
    );

    server.registerTool(
      'inventory_list_items',
      {
        title: 'انبار: فهرست کالاها',
        description: 'فهرست کالاهای انبار همراه با هشدار کسری (حداکثر ۱۰۰ ردیف).',
        inputSchema: {
          search: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async (args: any) =>
        this.run(() => this.tools.inventoryListItems(request, args)),
    );

    server.registerTool(
      'inventory_stock',
      {
        title: 'انبار: موجودی یک انبار',
        description: 'استعلام موجودی یک انبار به تفکیک کالا.',
        inputSchema: { warehouseId: z.number().int().positive() },
      },
      async (args: any) =>
        this.run(() => this.tools.inventoryStock(request, args)),
    );

    server.registerTool(
      'accounting_trial_balance',
      {
        title: 'حسابداری: تراز آزمایشی',
        description: 'تراز آزمایشی دفتر کل (فقط دسترسی مدیریتی).',
        inputSchema: {},
      },
      async () => this.run(() => this.tools.accountingTrialBalance(request)),
    );

    server.registerTool(
      'accounting_account_ledger',
      {
        title: 'حسابداری: گردش حساب',
        description:
          'گردش یک حساب دفتر کل با مانده افتتاح/اختتام (فقط دسترسی مدیریتی، حداکثر ۱۰۰ ردیف).',
        inputSchema: {
          code: z.string().min(1),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async (args: any) =>
        this.run(() => this.tools.accountingAccountLedger(request, args)),
    );

    server.registerTool(
      'import_list_entities',
      {
        title: 'ورود داده: موجودیت‌ها',
        description: 'فهرست موجودیت‌های قابل ورود و فیلدهای هرکدام.',
        inputSchema: {},
      },
      async () => this.run(() => this.tools.importListEntities(request)),
    );

    server.registerTool(
      'import_list_batches',
      {
        title: 'ورود داده: دسته‌ها',
        description:
          'آخرین دسته‌های ورود داده مستأجر (فقط مدیر پلتفرم یا مالک سازمان).',
        inputSchema: {},
      },
      async () => this.run(() => this.tools.importListBatches(request)),
    );

    server.registerTool(
      'crm_propose_lead',
      {
        title: 'CRM: پیشنهاد ثبت سرنخ',
        description:
          'اعتبارسنجی فیلدهای سرنخ و بازگرداندن پیشنهاد (بدون نوشتن؛ تأیید در UI).',
        inputSchema: {
          fullName: z.string().min(2).max(120),
          email: z.string().email().max(120),
          phone: z.string().max(50).optional(),
          company: z.string().max(150).optional(),
          pipelineStage: z.enum(Object.values(PipelineStage)).optional(),
          estimatedValue: z.number().min(0).optional(),
          owner: z.string().max(120).optional(),
          notes: z.string().max(4000).optional(),
        },
      },
      async (args: any) =>
        this.run(() => this.tools.crmProposeLead(request, args)),
    );

    server.registerTool(
      'hr_propose_employee',
      {
        title: 'HR: پیشنهاد ثبت پرسنل',
        description:
          'اعتبارسنجی فیلدهای پرسنل و بازگرداندن پیشنهاد (فقط دسترسی مدیریتی، بدون نوشتن).',
        inputSchema: {
          employeeNumber: z.string().max(32).optional(),
          firstName: z.string().min(2).max(64),
          lastName: z.string().min(2).max(64),
          nationalId: z.string().regex(/^[0-9]{10}$/),
          fatherName: z.string().max(64).optional(),
          mobile: z.string().regex(/^0?9[0-9]{9}$/),
          email: z.string().email().max(120).optional(),
          jobTitle: z.string().min(2).max(120),
          department: z.string().min(2).max(120),
          dependants: z.number().int().min(0).max(30).optional(),
          hireDate: z.string().optional(),
          bankAccountNumber: z.string().max(32).optional(),
        },
      },
      async (args: any) =>
        this.run(() => this.tools.hrProposeEmployee(request, args)),
    );

    server.registerTool(
      'accounting_propose_journal',
      {
        title: 'حسابداری: پیشنهاد سند',
        description:
          'اعتبارسنجی سطرهای سند دوطرفه و بازگرداندن پیشنهاد (فقط دسترسی مدیریتی، بدون نوشتن).',
        inputSchema: {
          lines: z
            .array(
              z.object({
                accountCode: z.string().min(1).max(32),
                debit: z.number().min(0).optional(),
                credit: z.number().min(0).optional(),
                description: z.string().max(255).optional(),
              }),
            )
            .min(2),
        },
      },
      async (args: any) =>
        this.run(() => this.tools.accountingProposeJournal(request, args)),
    );

    return server;
  }
}
