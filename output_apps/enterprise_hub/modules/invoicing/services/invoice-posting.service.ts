import { Injectable, Logger } from '@nestjs/common';
import { AccountResponseDto } from '../../accounting/dto/account-response.dto';
import { JournalEntryLineDto } from '../../accounting/dto/create-journal-entry.dto';
import { AccountType } from '../../accounting/enums/accounting.enum';
import { AccountingService } from '../../accounting/services/accounting.service';
import { Currency } from '../../currency/enums/currency.enum';
import { InventoryService } from '../../inventory/services/inventory.service';
import {
  CASH_BANK_ACCOUNT,
  InvoiceAccountSpec,
  MAX_POSTING_ERROR_LENGTH,
  RECEIVABLE_ACCOUNT,
  SALES_ACCOUNT,
  SuiteInvoiceStatusEvent,
  VAT_ACCOUNT,
} from '../constants/suite-events.constants';
import { InvoiceEntity, InvoiceItem } from '../entities/invoice.entity';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { InvoicingRepository } from '../repositories/invoicing.repository';

/**
 * سرویس ثبت خودکار رویدادهای صورتحساب در سایر ماژول‌های مجموعه.
 *
 * با تغییر وضعیت صورتحساب، این سرویس:
 *   • ISSUED    → خروج کالای سطرهای پیوند‌خورده از انبار + سند «AR / Sales + VAT».
 *   • PAID      → سند «Cash-Bank / AR».
 *   • CANCELLED → سند برگشتی + ورود مجدد کالا به انبار (بازگرداندن موجودی).
 *
 * همه عملیات مستأجرمحور و ایدمپوتنت‌اند: شناسه سند ذخیره‌شده روی صورتحساب
 * مانع ثبت دوباره می‌شود. خطاها لاگ شده و روی `posting_error` صورتحساب
 * بازتاب می‌یابند تا کاربر بتواند وضعیت را ببیند.
 */
@Injectable()
export class InvoicePostingService {
  private readonly logger = new Logger(InvoicePostingService.name);

  constructor(
    private readonly invoicingRepository: InvoicingRepository,
    private readonly inventoryService: InventoryService,
    private readonly accountingService: AccountingService,
  ) {}

  /** نقطه ورود پردازشگر صف؛ بر اساس وضعیت مقصد، رویداد مناسب را اجرا می‌کند. */
  async handle(event: SuiteInvoiceStatusEvent): Promise<void> {
    if (!event?.tenantId || !event?.invoiceId) {
      this.logger.warn('Suite event rejected: missing tenantId/invoiceId.');
      return;
    }

    switch (event.status) {
      case InvoiceStatus.ISSUED:
        await this.postIssued(event);
        break;
      case InvoiceStatus.PAID:
        await this.postPaid(event);
        break;
      case InvoiceStatus.CANCELLED:
        await this.postCancelled(event);
        break;
      default:
        this.logger.warn(`Unknown invoice status event: ${event.status}`);
        break;
    }
  }

  /**
   * ثبت رویداد صدور. در صورت وجود `journalEntryId` (قبلاً ثبت شده) هیچ کاری
   * انجام نمی‌شود تا اجرای دوبارهٔ کار صف، گردش انبار/دفاتر را تکرار نکند.
   */
  async postIssued(event: SuiteInvoiceStatusEvent): Promise<void> {
    const invoice = await this.invoicingRepository.findById(
      event.tenantId,
      event.invoiceId,
    );
    if (!invoice) {
      this.logger.warn(`Invoice ${event.invoiceId} not found for issuance.`);
      return;
    }
    if (invoice.journalEntryId !== null && invoice.journalEntryId !== undefined) {
      return;
    }

    try {
      await this.recordOutboundMovements(invoice);
      const entry = await this.createIssuedJournalEntry(invoice);
      await this.invoicingRepository.updatePosting(invoice.tenantId, invoice.id, {
        journalEntryId: entry.id,
        postingError: null,
      });
    } catch (error) {
      await this.recordPostingError(invoice, error);
    }
  }

  /**
   * ثبت رویداد تسویه. اگر صورتحساب هنوز سند صدور ندارد (گذار مستقیم
   * DRAFT → PAID)، ابتدا سند صدور ثبت می‌شود تا حساب دریافتنی شکل بگیرد.
   */
  async postPaid(event: SuiteInvoiceStatusEvent): Promise<void> {
    let invoice = await this.invoicingRepository.findById(
      event.tenantId,
      event.invoiceId,
    );
    if (!invoice) {
      this.logger.warn(`Invoice ${event.invoiceId} not found for payment.`);
      return;
    }
    if (invoice.paidJournalEntryId !== null && invoice.paidJournalEntryId !== undefined) {
      return;
    }

    if (invoice.journalEntryId === null || invoice.journalEntryId === undefined) {
      await this.postIssued(event);
      invoice = await this.invoicingRepository.findById(
        event.tenantId,
        event.invoiceId,
      );
      if (!invoice || invoice.journalEntryId === null || invoice.journalEntryId === undefined) {
        return;
      }
    }

    try {
      const receivable = this.rialAmount(invoice, invoice.finalPayable);
      const [cashCode, receivableCode] = await this.resolveAccounts(
        invoice.tenantId,
        [CASH_BANK_ACCOUNT, RECEIVABLE_ACCOUNT],
      );

      const entry = await this.accountingService.createJournalEntry(
        invoice.tenantId,
        {
          entryNumber: this.entryNumber(invoice, 'PAID'),
          date: this.entryDate(invoice.paidAt ?? invoice.issuedAt),
          description: `تسویه صورتحساب ${invoice.taxInvoiceNumber}`,
          lines: [
            {
              accountCode: cashCode,
              debit: receivable,
              description: 'دریافت نقدی/بانکی بابت صورتحساب',
            },
            {
              accountCode: receivableCode,
              credit: receivable,
              description: 'تسویه حساب‌های دریافتنی',
            },
          ],
        },
      );

      await this.invoicingRepository.updatePosting(invoice.tenantId, invoice.id, {
        paidJournalEntryId: entry.id,
        postingError: null,
      });
    } catch (error) {
      await this.recordPostingError(invoice, error);
    }
  }

  /**
   * ثبت رویداد ابطال پس از صدور: سند برگشتی و بازگرداندن موجودی کالا. اگر
   * صورتحساب هرگز صادر نشده باشد (سند صدور ندارد) کاری لازم نیست.
   */
  async postCancelled(event: SuiteInvoiceStatusEvent): Promise<void> {
    const invoice = await this.invoicingRepository.findById(
      event.tenantId,
      event.invoiceId,
    );
    if (!invoice) {
      this.logger.warn(`Invoice ${event.invoiceId} not found for cancellation.`);
      return;
    }
    if (
      invoice.reversalJournalEntryId !== null &&
      invoice.reversalJournalEntryId !== undefined
    ) {
      return;
    }
    if (invoice.journalEntryId === null || invoice.journalEntryId === undefined) {
      return;
    }

    try {
      const receivable = this.rialAmount(invoice, invoice.finalPayable);
      const salesBase = this.rialAmount(
        invoice,
        invoice.finalPayable - invoice.totalTax,
      );
      const vat = this.rialAmount(invoice, invoice.totalTax);
      const [salesCode, vatCode, receivableCode] = await this.resolveAccounts(
        invoice.tenantId,
        [SALES_ACCOUNT, VAT_ACCOUNT, RECEIVABLE_ACCOUNT],
      );

      const lines: JournalEntryLineDto[] = [
        {
          accountCode: salesCode,
          debit: salesBase,
          description: 'برگشت درآمد فروش',
        },
      ];
      if (vat > 0) {
        lines.push({
          accountCode: vatCode,
          debit: vat,
          description: 'برگشت مالیات بر ارزش افزوده',
        });
      }
      lines.push({
        accountCode: receivableCode,
        credit: receivable,
        description: 'برگشت حساب‌های دریافتنی',
      });

      const entry = await this.accountingService.createJournalEntry(
        invoice.tenantId,
        {
          entryNumber: this.entryNumber(invoice, 'CANCEL'),
          date: this.entryDate(invoice.issuedAt),
          description: `ابطال صورتحساب ${invoice.taxInvoiceNumber}`,
          lines,
        },
      );

      await this.restoreInboundMovements(invoice);
      await this.invoicingRepository.updatePosting(invoice.tenantId, invoice.id, {
        reversalJournalEntryId: entry.id,
        postingError: null,
      });
    } catch (error) {
      await this.recordPostingError(invoice, error);
    }
  }

  /** ثبت خروج انبار برای هر سطر پیوند‌خورده به کالای انبار. */
  private async recordOutboundMovements(invoice: InvoiceEntity): Promise<void> {
    for (const line of invoice.items ?? []) {
      if (!this.isLinkedLine(line)) {
        continue;
      }
      await this.inventoryService.issueStock(invoice.tenantId, {
        sku: line.sku as string,
        quantity: line.quantity,
        reference: `فاکتور ${invoice.taxInvoiceNumber}`,
      });
    }
  }

  /** ورود مجدد کالا به انبار برای بازگرداندن موجودی هنگام ابطال. */
  private async restoreInboundMovements(invoice: InvoiceEntity): Promise<void> {
    const fxRate = this.resolveFxRate(invoice);
    for (const line of invoice.items ?? []) {
      if (!this.isLinkedLine(line)) {
        continue;
      }
      const unitCost = this.round(line.unitPrice * fxRate);
      await this.inventoryService.receiveStock(invoice.tenantId, {
        sku: line.sku as string,
        quantity: line.quantity,
        unitPurchaseCost: unitCost > 0 ? unitCost : 1,
        reference: `ابطال فاکتور ${invoice.taxInvoiceNumber}`,
      });
    }
  }

  /** آیا سطر به کالای انبار پیوند خورده است؟ (در غیر این صورت نادیده گرفته می‌شود.) */
  private isLinkedLine(
    line: InvoiceItem,
  ): line is InvoiceItem & { itemId: number; sku: string } {
    return (
      line.itemId !== null &&
      line.itemId !== undefined &&
      typeof line.sku === 'string' &&
      line.sku.length > 0
    );
  }

  /**
   * ساخت سند صدور: بدهکار حساب‌های دریافتنی، بستانکار فروش و مالیات پرداختنی.
   * مبالغ به ریال (ارز صورتحساب × نرخ تبدیل) محاسبه می‌شوند.
   */
  private async createIssuedJournalEntry(invoice: InvoiceEntity) {
    const receivable = this.rialAmount(invoice, invoice.finalPayable);
    const salesBase = this.rialAmount(
      invoice,
      invoice.finalPayable - invoice.totalTax,
    );
    const vat = this.rialAmount(invoice, invoice.totalTax);
    const [receivableCode, salesCode, vatCode] = await this.resolveAccounts(
      invoice.tenantId,
      [RECEIVABLE_ACCOUNT, SALES_ACCOUNT, VAT_ACCOUNT],
    );

    const lines: JournalEntryLineDto[] = [
      {
        accountCode: receivableCode,
        debit: receivable,
        description: `صدور صورتحساب ${invoice.taxInvoiceNumber}`,
      },
    ];
    if (salesBase > 0) {
      lines.push({
        accountCode: salesCode,
        credit: salesBase,
        description: 'درآمد فروش',
      });
    }
    if (vat > 0) {
      lines.push({
        accountCode: vatCode,
        credit: vat,
        description: 'مالیات بر ارزش افزوده پرداختنی',
      });
    }

    return this.accountingService.createJournalEntry(invoice.tenantId, {
      entryNumber: this.entryNumber(invoice, 'ISSUED'),
      date: this.entryDate(invoice.issuedAt),
      description: `صدور صورتحساب ${invoice.taxInvoiceNumber}`,
      lines,
    });
  }

  /**
   * حل کد حساب‌ها: ابتدا تطابق نام در همان ماهیت، سپس تطابق کد، و در نهایت
   * ساخت حساب پیش‌فرض در صورت نبود. ترتیب دقیقاً مطابق قرارداد رویداد است.
   */
  private async resolveAccounts(
    tenantId: string,
    specs: InvoiceAccountSpec[],
  ): Promise<string[]> {
    const accounts = await this.accountingService.listAccounts(tenantId);
    const codes: string[] = [];

    for (const spec of specs) {
      const existing = this.findAccountCode(accounts, spec);
      if (existing) {
        codes.push(existing);
        continue;
      }

      try {
        const created = await this.accountingService.createAccount(tenantId, {
          code: spec.code,
          name: spec.name,
          accountType: spec.accountType,
          currency: Currency.IRR,
        });
        accounts.push(created);
        codes.push(created.code);
      } catch {
        // ساخت هم‌زمان توسط درخواست دیگر؛ به کد پیش‌فرض بسنده می‌کنیم.
        codes.push(spec.code);
      }
    }

    return codes;
  }

  private findAccountCode(
    accounts: AccountResponseDto[],
    spec: InvoiceAccountSpec,
  ): string | null {
    const byName = accounts.find(
      (account) =>
        account.accountType === spec.accountType &&
        spec.match.some((fragment) => account.name.includes(fragment)),
    );
    if (byName) {
      return byName.code;
    }
    const byCode = accounts.find((account) => account.code === spec.code);
    return byCode ? byCode.code : null;
  }

  /** مبلغ ریالی: مبلغ ارز صورتحساب × نرخ تبدیل ریالی (پیش‌فرض ۱). */
  private rialAmount(invoice: InvoiceEntity, amount: number): number {
    return this.round(Number(amount ?? 0) * this.resolveFxRate(invoice));
  }

  private resolveFxRate(invoice: InvoiceEntity): number {
    const rate = Number(invoice.fxRate);
    return Number.isFinite(rate) && rate > 0 ? rate : 1;
  }

  /** شماره سند یکتا و قابل‌بازتولید برای هر گذر وضعیت. */
  private entryNumber(invoice: InvoiceEntity, suffix: string): string {
    return `INV-${invoice.id}-${suffix}`;
  }

  /** تاریخ سند: زمان گذر وضعیت، در نبود آن زمان جاری. */
  private entryDate(value: Date | null | undefined): string {
    const date = value ? new Date(value) : new Date();
    return date.toISOString();
  }

  /** لاگ و بازتاب خطا روی صورتحساب؛ هرگز رویداد را دوباره پرتاب نمی‌کند. */
  private async recordPostingError(
    invoice: InvoiceEntity,
    error: unknown,
  ): Promise<void> {
    const message = (error instanceof Error ? error.message : String(error)).slice(
      0,
      MAX_POSTING_ERROR_LENGTH,
    );
    this.logger.error(
      `Invoice ${invoice.id} posting failed: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
    try {
      await this.invoicingRepository.updatePosting(invoice.tenantId, invoice.id, {
        postingError: message,
      });
    } catch (persistError) {
      this.logger.error(
        `Failed to persist posting_error for invoice ${invoice.id}: ${
          (persistError as Error).message
        }`,
      );
    }
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
