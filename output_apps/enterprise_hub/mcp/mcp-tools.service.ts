import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AccountingService } from '../modules/accounting/services/accounting.service';
import {
  BALANCE_TOLERANCE,
  MONEY_SCALE,
} from '../modules/accounting/constants/accounting.constants';
import { AccountLedgerResponseDto } from '../modules/accounting/dto/account-ledger-response.dto';
import { JournalEntryLineDto } from '../modules/accounting/dto/create-journal-entry.dto';
import { QueryAccountLedgerDto } from '../modules/accounting/dto/query-journal-entry.dto';
import { TrialBalanceResponseDto } from '../modules/accounting/dto/trial-balance-response.dto';
import { CreateLeadDto } from '../modules/crm/dto/create-lead.dto';
import {
  LeadResponseDto,
  PaginatedLeadsResponseDto,
} from '../modules/crm/dto/crm-lead-response.dto';
import { QueryLeadDto } from '../modules/crm/dto/query-lead.dto';
import { PipelineStage } from '../modules/crm/enums/crm.enums';
import { CrmService } from '../modules/crm/services/crm.service';
import { BatchSummaryDto } from '../modules/data_import/dto/batch-response.dto';
import { EntityDescriptorDto } from '../modules/data_import/dto/entity-descriptor-response.dto';
import { EntityImportService } from '../modules/data_import/services/entity-import.service';
import { CreateEmployeeDto } from '../modules/hr/dto/create-employee.dto';
import { PaginatedEmployeeResponseDto } from '../modules/hr/dto/hr-response.dto';
import { QueryEmployeeDto } from '../modules/hr/dto/query-hr.dto';
import { HrService } from '../modules/hr/services/hr.service';
import { StockItemResponseDto } from '../modules/inventory/dto/stock-item-response.dto';
import { QueryStockItemDto } from '../modules/inventory/dto/query-stock-item.dto';
import { WarehouseStockResponseDto } from '../modules/inventory/dto/warehouse-stock-response.dto';
import { InventoryService } from '../modules/inventory/services/inventory.service';
import { AuthenticatedRequest } from '../modules/auth/guards/jwt-auth.guard';
import { UserRole } from '../modules/auth/enums/user-role.enum';
import { TenantRole } from '../modules/tenants/enums/tenant-role.enum';
import {
  requireTenantAdmin,
  requireTenantId,
} from '../modules/tenants/tenant-context';
import { Proposal } from './proposal.types';

/** حداکثر تعداد ردیف بازگشتی در هر فراخوانی ابزار MCP. */
export const MAX_TOOL_ROWS = 100;

/** تعداد پیش‌فرض ردیف‌ها هنگام عدم ارسال `limit`. */
export const DEFAULT_TOOL_ROWS = 20;

/** ورودی مشترک ابزارهای فهرست (جست‌وجو + محدودیت ردیف). */
export interface ListQueryInput {
  search?: string;
  limit?: number;
}

/** ورودی `crm_list_leads`. */
export interface CrmListLeadsInput extends ListQueryInput {
  stage?: PipelineStage;
}

/** ورودی ابزارهای مبتنی بر شناسه عددی. */
export interface IdInput {
  id: number;
}

/** ورودی `inventory_stock`. */
export interface WarehouseStockInput {
  warehouseId: number;
}

/** ورودی `accounting_account_ledger`. */
export interface AccountLedgerInput {
  code: string;
  limit?: number;
}

/** سطر نرمال‌شده سند پیشنهادی (بدهکار یا بستانکار). */
export interface ProposedJournalLine {
  accountCode: string;
  debit: number;
  credit: number;
  description: string | null;
}

/** بارِ پیشنهادی سند حسابداری. */
export interface ProposedJournalPayload {
  lines: ProposedJournalLine[];
  totalDebit: number;
  totalCredit: number;
}

/** صفحه کالاهای انبار همان‌طور که `InventoryService.listStockItems` برمی‌گرداند. */
export interface StockItemsPage {
  data: StockItemResponseDto[];
  total: number;
  page: number;
  limit: number;
  lowStockCount: number;
}

/**
 * پیاده‌سازی ابزارهای MCP روی ماژول‌های سازمانی موجود.
 *
 * هر ابزار فقط از سرویس ماژول مالک استفاده می‌کند (هیچ SQL خامی اجرا نمی‌شود،
 * Rule #3 - AGENTS.md) و شناسه مستأجر «تنها» از `requireTenantId(request)`
 * خوانده می‌شود؛ هرگز از ورودی ابزار (Rule #4 - AGENTS.md). ابزارهای مدیریتی
 * (منابع انسانی و حسابداری) همان `requireTenantAdmin` کنترلرهای REST را اعمال
 * می‌کنند. ابزارهای propose هیچ نوشتنی انجام نمی‌دهند و تنها اعتبارسنجی/پیشنهاد
 * برمی‌گردانند.
 */
@Injectable()
export class McpToolsService {
  constructor(
    private readonly crmService: CrmService,
    private readonly hrService: HrService,
    private readonly inventoryService: InventoryService,
    private readonly accountingService: AccountingService,
    private readonly entityImportService: EntityImportService,
  ) {}

  private round(value: number): number {
    const factor = 10 ** MONEY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  /** اعتبارسنجی و کرانمندسازی `limit` در بازه [۱, MAX_TOOL_ROWS]. */
  private limit(
    value: number | undefined,
    fallback = DEFAULT_TOOL_ROWS,
  ): number {
    const parsed = Math.trunc(Number(value ?? fallback));
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(Math.max(parsed, 1), MAX_TOOL_ROWS);
  }

  /** دسترسی مدیریتی همانند کنترلرهای منابع انسانی و حسابداری. */
  private assertAdmin(request: AuthenticatedRequest): void {
    requireTenantAdmin(request);
  }

  /** اجازه ورود داده: مدیر پلتفرم یا مالک سازمان (هم‌ارز کنترلر ورود داده). */
  private assertImportAccess(request: AuthenticatedRequest): void {
    const isAdmin = request.user?.role === UserRole.ADMIN;
    const isOwner = request.user?.tenantRole === TenantRole.OWNER;
    if (!isAdmin && !isOwner) {
      throw new ForbiddenException(
        'ورود داده فقط برای مدیر پلتفرم یا مالک سازمان مجاز است.',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // ابزارهای خواندنی (read)
  // ---------------------------------------------------------------------------

  /** `crm_list_leads`: فهرست صفحه‌بندی‌شده سرنخ‌ها با فیلتر مرحله و جست‌وجو. */
  async crmListLeads(
    request: AuthenticatedRequest,
    input: CrmListLeadsInput,
  ): Promise<PaginatedLeadsResponseDto> {
    const tenantId = requireTenantId(request);
    return this.crmService.listLeads(tenantId, {
      page: 1,
      limit: this.limit(input.limit),
      search: input.search?.trim() || undefined,
      stage: input.stage,
    } as QueryLeadDto);
  }

  /** `crm_get_lead`: دریافت یک سرنخ بر اساس شناسه. */
  async crmGetLead(
    request: AuthenticatedRequest,
    input: IdInput,
  ): Promise<LeadResponseDto> {
    const tenantId = requireTenantId(request);
    return this.crmService.getLead(tenantId, input.id);
  }

  /** `hr_list_employees`: فهرست پرسنل (مدیریتی). */
  async hrListEmployees(
    request: AuthenticatedRequest,
    input: ListQueryInput,
  ): Promise<PaginatedEmployeeResponseDto> {
    this.assertAdmin(request);
    const tenantId = requireTenantId(request);
    return this.hrService.listEmployees(tenantId, {
      page: 1,
      limit: this.limit(input.limit),
      search: input.search?.trim() || undefined,
    } as QueryEmployeeDto);
  }

  /** `inventory_list_items`: فهرست کالاهای انبار همراه با هشدار کسری. */
  async inventoryListItems(
    request: AuthenticatedRequest,
    input: ListQueryInput,
  ): Promise<StockItemsPage> {
    const tenantId = requireTenantId(request);
    return this.inventoryService.listStockItems(tenantId, {
      page: 1,
      limit: this.limit(input.limit),
      search: input.search?.trim() || undefined,
      lowStockOnly: false,
    } as QueryStockItemDto);
  }

  /** `inventory_stock`: استعلام موجودی یک انبار به تفکیک کالا. */
  async inventoryStock(
    request: AuthenticatedRequest,
    input: WarehouseStockInput,
  ): Promise<WarehouseStockResponseDto> {
    const tenantId = requireTenantId(request);
    return this.inventoryService.getWarehouseStock(tenantId, input.warehouseId);
  }

  /** `accounting_trial_balance`: تراز آزمایشی دفتر کل (مدیریتی). */
  async accountingTrialBalance(
    request: AuthenticatedRequest,
  ): Promise<TrialBalanceResponseDto> {
    this.assertAdmin(request);
    const tenantId = requireTenantId(request);
    return this.accountingService.getTrialBalance(tenantId);
  }

  /** `accounting_account_ledger`: گردش یک حساب دفتر کل (مدیریتی). */
  async accountingAccountLedger(
    request: AuthenticatedRequest,
    input: AccountLedgerInput,
  ): Promise<AccountLedgerResponseDto> {
    this.assertAdmin(request);
    const tenantId = requireTenantId(request);
    return this.accountingService.getAccountLedger(tenantId, input.code, {
      limit: this.limit(input.limit, MAX_TOOL_ROWS),
    } as QueryAccountLedgerDto);
  }

  /** `import_list_entities`: فهرست موجودیت‌های قابل ورود و فیلدهای آن‌ها. */
  importListEntities(_request: AuthenticatedRequest): EntityDescriptorDto[] {
    return this.entityImportService.listEntities();
  }

  /** `import_list_batches`: آخرین دسته‌های ورود داده مستأجر (مدیریتی). */
  async importListBatches(
    request: AuthenticatedRequest,
  ): Promise<BatchSummaryDto[]> {
    this.assertImportAccess(request);
    const tenantId = requireTenantId(request);
    return this.entityImportService.listBatches(tenantId);
  }

  // ---------------------------------------------------------------------------
  // ابزارهای پیشنهادی (propose) — بدون هیچ نوشتن
  // ---------------------------------------------------------------------------

  /** `crm_propose_lead`: اعتبارسنجی و پیشنهاد ثبت سرنخ جدید. */
  async crmProposeLead(
    request: AuthenticatedRequest,
    fields: CreateLeadDto,
  ): Promise<Proposal<'crm.lead', CreateLeadDto>> {
    const tenantId = requireTenantId(request);
    const email = fields.email.trim().toLowerCase();
    const existing = await this.crmService.listLeads(tenantId, {
      page: 1,
      limit: 5,
      search: email,
    } as QueryLeadDto);

    const warnings: string[] = [];
    if (existing.data.some((lead) => lead.email?.toLowerCase() === email)) {
      warnings.push(`سرنخی با رایانامه ${email} از قبل وجود دارد.`);
    }

    return {
      kind: 'crm.lead',
      payload: { ...fields, email },
      warnings,
    };
  }

  /** `hr_propose_employee`: اعتبارسنجی و پیشنهاد ثبت پرسنل جدید (مدیریتی). */
  async hrProposeEmployee(
    request: AuthenticatedRequest,
    fields: CreateEmployeeDto,
  ): Promise<Proposal<'hr.employee', CreateEmployeeDto>> {
    this.assertAdmin(request);
    const tenantId = requireTenantId(request);
    const existing = await this.hrService.listEmployees(tenantId, {
      page: 1,
      limit: 5,
      search: fields.nationalId,
    } as QueryEmployeeDto);

    const warnings: string[] = [];
    if (existing.data.some((employee) => employee.nationalId === fields.nationalId)) {
      warnings.push(`کارمندی با کد ملی ${fields.nationalId} از قبل وجود دارد.`);
    }

    return {
      kind: 'hr.employee',
      payload: fields,
      warnings,
    };
  }

  /**
   * `accounting_propose_journal`: اعتبارسنجی و پیشنهاد ثبت سند حسابداری دوطرفه.
   *
   * اعتبارسنجی معنایی (یک‌طرفه‌بودن هر سطر و تراز بودن سند) به‌صورت محلی انجام
   * می‌شود و هیچ فراخوانی نوشتنی/بذرگذاری روی دفتر کل صورت نمی‌گیرد.
   */
  accountingProposeJournal(
    request: AuthenticatedRequest,
    input: { lines: JournalEntryLineDto[] },
  ): Proposal<'accounting.journal', ProposedJournalPayload> {
    this.assertAdmin(request);
    requireTenantId(request);

    if (!Array.isArray(input.lines) || input.lines.length < 2) {
      throw new BadRequestException('سند باید حداقل دو سطر داشته باشد.');
    }

    const warnings: string[] = [];
    const lines: ProposedJournalLine[] = input.lines.map((line) => {
      const debit = this.round(Number(line.debit ?? 0));
      const credit = this.round(Number(line.credit ?? 0));

      if (debit < 0 || credit < 0) {
        throw new BadRequestException(
          'مبالغ بدهکار و بستانکار نمی‌توانند منفی باشند.',
        );
      }
      if (debit > 0 && credit > 0) {
        throw new BadRequestException(
          `سطر حساب ${line.accountCode} نمی‌تواند هم‌زمان بدهکار و بستانکار باشد.`,
        );
      }
      if (debit === 0 && credit === 0) {
        throw new BadRequestException(
          `سطر حساب ${line.accountCode} باید یا بدهکار یا بستانکار بزرگ‌تر از صفر داشته باشد.`,
        );
      }
      if (!line.description) {
        warnings.push(`سطر حساب ${line.accountCode} بدون شرح است.`);
      }

      return {
        accountCode: line.accountCode,
        debit,
        credit,
        description: line.description ?? null,
      };
    });

    const totalDebit = this.round(
      lines.reduce((sum, line) => sum + line.debit, 0),
    );
    const totalCredit = this.round(
      lines.reduce((sum, line) => sum + line.credit, 0),
    );

    if (Math.abs(totalDebit - totalCredit) >= BALANCE_TOLERANCE) {
      throw new BadRequestException(
        `سند تراز نیست: جمع بدهکار (${totalDebit}) با جمع بستانکار (${totalCredit}) برابر نیست.`,
      );
    }

    return {
      kind: 'accounting.journal',
      payload: { lines, totalDebit, totalCredit },
      warnings,
    };
  }
}
