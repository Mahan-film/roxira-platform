import { Injectable, Logger, Optional } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { minorToDecimal, parseScaled, toMinor } from '../../accounting/money';
import { decideRoleAccount } from '../../accounting/services/role-account-resolver';
import { AccountingService } from '../../accounting/services/accounting.service';
import { Currency } from '../../currency/enums/currency.enum';
import { PostingRole } from '../../posting_rules/constants/posting-roles';
import { RoleAccounts } from '../../posting_rules/domain/posting-engine';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { StockDocumentsRepository } from '../../inventory/repositories/stock-documents.repository';
import { STOCK_DOCUMENT_PREFIX, StockDocumentType } from '../../inventory/enums/stock-document.enum';
import {
  assertValidQuantityScale,
  QUANTITY_SCALE,
} from '../../inventory/constants/inventory.constants';
import { InventoryService } from '../../inventory/services/inventory.service';
import {
  CASH_BANK_ACCOUNT,
  COGS_ACCOUNT,
  INVENTORY_ACCOUNT,
  InvoiceAccountSpec,
  MAX_POSTING_ERROR_LENGTH,
  PAYABLE_ACCOUNT,
  POS_CLEARING_ACCOUNT,
  PURCHASES_ACCOUNT,
  RECEIVABLE_ACCOUNT,
  SALES_ACCOUNT,
  SuiteInvoiceStatusEvent,
  VAT_ACCOUNT,
  VAT_RECEIVABLE_ACCOUNT,
} from '../constants/suite-events.constants';
import {
  InvoiceEntity,
  InvoiceItem,
  InvoicePostingMeta,
} from '../entities/invoice.entity';
import { InvoiceDirection, InvoiceSubject } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { InvoicingRepository } from '../repositories/invoicing.repository';
import {
  documentDocType,
  documentRows,
  drCrAmounts,
  mergeRoleAccounts,
  settleDocType,
  settleRows,
} from './invoice-voucher';

/** The signed rial amounts one invoice document posts, in minor units (rial x 100). */
interface PostedAmounts {
  /** Owed by the customer (sale) or to the supplier (purchase). */
  receivable: bigint;
  vat: bigint;
  /** Goods and services before VAT: receivable - vat. */
  net: bigint;
  /** Change in the value of stock: positive when stock comes in, negative when it goes out. */
  stock: bigint;
}

/**
 * سرویس ثبت خودکار رویدادهای صورتحساب در سایر ماژول‌های مجموعه.
 *
 * فروش (SALE):
 *   • ISSUED    → خروج FIFO کالای سطرهای پیوند‌خورده + سند «AR / Sales + VAT» و «COGS / موجودی».
 *   • PAID      → سند «Cash-Bank / AR».
 *   • CANCELLED → قرینهٔ دقیق همان مبالغ و بازگشت کالا به بهای ثبت‌شده.
 * خرید (PURCHASE): ورود کالا با لایهٔ FIFO تازه + سند «موجودی/خرید + مالیات خرید / AP»؛ پرداخت
 * «AP / Cash-Bank».
 * موضوع برگشتی (RETURN) قرینهٔ مبالغ و جابه‌جایی کالا؛ اصلاحی (CORRECTIVE) فقط اختلاف مالی با
 * آخرین نسخهٔ صادرشده؛ ابطالی (CANCEL) خودش سندی ندارد و صورتحساب مرجع را ابطال می‌کند.
 *
 * هیچ نرخ مالیاتی اینجا نیست: مبالغ فقط از ارقام ذخیره‌شده روی سطرهای صورتحساب می‌آیند.
 * همه عملیات مستأجرمحور و ایدمپوتنت‌اند: شناسه سند
 * ذخیره‌شده روی صورتحساب مانع ثبت دوباره می‌شود و خطا روی `posting_error` می‌نشیند.
 */
@Injectable()
export class InvoicePostingService {
  private readonly logger = new Logger(InvoicePostingService.name);

  constructor(
    private readonly invoicingRepository: InvoicingRepository,
    private readonly inventoryService: InventoryService,
    private readonly accountingService: AccountingService,
    private readonly postingRules: PostingRulesService,
    @Optional() private readonly stockDocuments?: StockDocumentsRepository,
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
    // A cancel-subject document has nothing to post itself: it cancels its related invoice.
    if (this.subjectOf(invoice) === InvoiceSubject.CANCEL) {
      return;
    }

    try {
      // Accounts are only planned (read-only) before the transaction. A missing one is created
      // inside it, after the amounts are known, and only if a voucher line for it is non-zero.
      const plan = await this.resolveAccountMap(
        invoice,
        'document',
        this.movesStock(invoice),
      );
      const overrides = await this.roleOverrides(invoice, 'issue', plan.codes);
      // One transaction: stock movement, journal entry and the posting marker commit together
      // or not at all, and the invoice row lock makes a concurrent run wait and then no-op.
      await this.invoicingRepository.transaction(async (manager) => {
        const locked = await this.invoicingRepository.findByIdForPosting(
          invoice.tenantId,
          invoice.id,
          manager,
        );
        if (
          !locked ||
          (locked.journalEntryId !== null && locked.journalEntryId !== undefined)
        ) {
          return;
        }
        const meta = await this.moveStockAndMeasure(locked, manager);
        const stockDocumentId = await this.recordStockDocument(locked, meta, manager);
        const request = this.documentRequest(locked, this.fromMeta(meta), false);
        await this.ensurePlanned(locked, plan, overrides, request.amounts);
        const entry = await this.postVoucher(
          locked,
          'ISSUED',
          this.entryDate(locked.issuedAt),
          `صدور صورتحساب ${locked.taxInvoiceNumber}`,
          request,
          overrides,
          manager,
        );
        if (stockDocumentId !== null) {
          await manager.update('erp_stock_documents', { id: stockDocumentId, tenantId: locked.tenantId }, { journalEntryId: entry.entryId });
        }
        await this.invoicingRepository.updatePosting(
          locked.tenantId,
          locked.id,
          { journalEntryId: entry.entryId, postingError: null, postingMeta: meta },
          manager,
        );
      }, invoice.tenantId);
    } catch (error) {
      await this.recordPostingError(invoice, error);
    }
  }

  /**
   * ثبت رویداد تسویه. اگر صورتحساب هنوز سند صدور ندارد (گذار مستقیم
   * DRAFT → PAID)، ابتدا سند صدور ثبت می‌شود تا حساب دریافتنی/پرداختنی شکل بگیرد.
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
      const plan = await this.resolveAccountMap(invoice, 'payment', false);
      const overrides = await this.roleOverrides(invoice, 'settle', plan.codes);
      await this.invoicingRepository.transaction(async (manager) => {
        const locked = await this.invoicingRepository.findByIdForPosting(
          invoice!.tenantId,
          invoice!.id,
          manager,
        );
        if (
          !locked ||
          (locked.paidJournalEntryId !== null &&
            locked.paidJournalEntryId !== undefined)
        ) {
          return;
        }
        const owed = this.postedOf(locked).receivable;
        const sale = this.directionOf(locked) === InvoiceDirection.SALE;
        // Sale: cash comes in, receivable falls. Purchase: payable falls, cash goes out.
        const split = this.splitPayments(locked, owed);
        const request = {
          docType: settleDocType(sale, split),
          amounts: drCrAmounts(settleRows(sale, split, owed)),
        };
        await this.ensurePlanned(locked, plan, overrides, request.amounts);
        const entry = await this.postVoucher(
          locked,
          'PAID',
          this.entryDate(locked.paidAt ?? locked.issuedAt),
          `تسویه صورتحساب ${locked.taxInvoiceNumber}`,
          request,
          overrides,
          manager,
        );
        await this.invoicingRepository.updatePosting(
          locked.tenantId,
          locked.id,
          { paidJournalEntryId: entry.entryId, postingError: null },
          manager,
        );
      }, invoice.tenantId);
    } catch (error) {
      await this.recordPostingError(invoice, error);
    }
  }

  /**
   * ثبت رویداد ابطال پس از صدور: قرینهٔ دقیق سند صدور و بازگرداندن جابه‌جایی کالا. اگر
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
      const plan = await this.resolveAccountMap(
        invoice,
        'document',
        (invoice.postingMeta?.lines.length ?? 0) > 0 ||
          (!invoice.postingMeta && this.movesStock(invoice)),
      );
      const overrides = await this.roleOverrides(invoice, 'cancel', plan.codes);

      await this.invoicingRepository.transaction(async (manager) => {
        const locked = await this.invoicingRepository.findByIdForPosting(
          invoice.tenantId,
          invoice.id,
          manager,
        );
        if (
          !locked ||
          (locked.reversalJournalEntryId !== null &&
            locked.reversalJournalEntryId !== undefined) ||
          locked.journalEntryId === null ||
          locked.journalEntryId === undefined
        ) {
          return;
        }

        const posted = this.postedOf(locked);
        await this.reverseStock(locked, manager);
        const request = this.documentRequest(locked, posted, true);
        await this.ensurePlanned(locked, plan, overrides, request.amounts);
        const entry = await this.postVoucher(
          locked,
          'CANCEL',
          this.entryDate(locked.issuedAt),
          `ابطال صورتحساب ${locked.taxInvoiceNumber}`,
          request,
          overrides,
          manager,
        );
        await this.invoicingRepository.updatePosting(
          locked.tenantId,
          locked.id,
          { reversalJournalEntryId: entry.entryId, postingError: null },
          manager,
        );
      }, invoice.tenantId);
    } catch (error) {
      await this.recordPostingError(invoice, error);
    }
  }

  // ---------------------------------------------------------------------------
  // Document kind
  // ---------------------------------------------------------------------------

  private directionOf(invoice: InvoiceEntity): InvoiceDirection {
    return invoice.direction ?? InvoiceDirection.SALE;
  }

  private subjectOf(invoice: InvoiceEntity): InvoiceSubject {
    return invoice.subject ?? InvoiceSubject.ORIGINAL;
  }

  // ---------------------------------------------------------------------------
  // Stock
  // ---------------------------------------------------------------------------

  /**
   * Moves stock for the linked lines and returns everything posting needs to remember: the
   * FIFO cost of what moved and the signed amounts. Sale and purchase-return take stock out
   * (FIFO cost is measured), purchase and sale-return bring it in (a purchase at its net cost,
   * a sale return at the cost the sale recorded). Corrective and unlinked lines move nothing.
   */
  private async moveStockAndMeasure(
    invoice: InvoiceEntity,
    manager: EntityManager,
  ): Promise<InvoicePostingMeta> {
    const direction = this.directionOf(invoice);
    const subject = this.subjectOf(invoice);
    const out =
      (direction === InvoiceDirection.SALE && subject === InvoiceSubject.ORIGINAL) ||
      (direction === InvoiceDirection.PURCHASE && subject === InvoiceSubject.RETURN);
    const into =
      (direction === InvoiceDirection.PURCHASE && subject === InvoiceSubject.ORIGINAL) ||
      (direction === InvoiceDirection.SALE && subject === InvoiceSubject.RETURN);

    const lines: InvoicePostingMeta['lines'] = [];
    if (out || into) {
      const related = into && direction === InvoiceDirection.SALE
        ? await this.relatedCosts(invoice, manager)
        : new Map<string, number>();
      for (const line of invoice.items ?? []) {
        if (!this.isLinkedLine(line)) {
          continue;
        }
        assertValidQuantityScale(line.quantity, QUANTITY_SCALE, `تعداد سطر «${line.sku}»`);
        const warehouseId = invoice.warehouseId ?? null;
        const reference = `${subject === InvoiceSubject.RETURN ? 'برگشت ' : ''}فاکتور ${invoice.taxInvoiceNumber}`;
        if (out) {
          const result = await this.inventoryService.issueStock(
            invoice.tenantId,
            {
              sku: line.sku,
              quantity: line.quantity,
              reference,
              ...(warehouseId ? { warehouseId } : {}),
            },
            manager,
          );
          lines.push({
            sku: line.sku,
            quantity: line.quantity,
            unitCost: this.round(result.totalCost / line.quantity),
            value: result.totalCost,
            moved: 'OUT',
            warehouseId,
          });
        } else {
          const unitCost =
            direction === InvoiceDirection.PURCHASE
              ? this.purchaseUnitCost(invoice, line)
              : related.get(line.sku) ?? this.round(line.unitPrice * this.resolveFxRate(invoice));
          const result = await this.inventoryService.receiveStock(
            invoice.tenantId,
            {
              sku: line.sku,
              quantity: line.quantity,
              unitPurchaseCost: unitCost > 0 ? unitCost : 1,
              reference,
              ...(warehouseId ? { warehouseId } : {}),
            },
            manager,
          );
          lines.push({
            sku: line.sku,
            quantity: line.quantity,
            unitCost: unitCost > 0 ? unitCost : 1,
            value: result.totalCost,
            moved: 'IN',
            warehouseId,
          });
        }
      }
    }

    const stockMinor = lines.reduce(
      (sum, line) => sum + (line.moved === 'IN' ? 1n : -1n) * toMinor(this.round(line.value)),
      0n,
    );
    const amounts = await this.amountsFor(invoice, manager);
    const net = amounts.net;
    // Purchases never book more to stock than the invoice net; the rest is an expense.
    const stock =
      direction === InvoiceDirection.PURCHASE
        ? this.clampToward(stockMinor, net)
        : stockMinor;
    return {
      stockValue: Number(minorToDecimal(stock < 0n ? -stock : stock)),
      lines,
      posted: {
        receivable: amounts.receivable.toString(),
        vat: amounts.vat.toString(),
        net: amounts.net.toString(),
        stock: stock.toString(),
      },
    };
  }

  /**
   * Leaves a stock document behind for the register: sales deliver, purchases receive, returns
   * are signed adjustments. Numbered after the invoice so a re-run can never create it twice.
   */
  private async recordStockDocument(
    invoice: InvoiceEntity,
    meta: InvoicePostingMeta,
    manager: EntityManager,
  ): Promise<number | null> {
    if (!this.stockDocuments || meta.lines.length === 0) {
      return null;
    }
    const direction = this.directionOf(invoice);
    const original = this.subjectOf(invoice) === InvoiceSubject.ORIGINAL;
    const docType = !original
      ? StockDocumentType.ADJUSTMENT
      : direction === InvoiceDirection.SALE
        ? StockDocumentType.SALES_DELIVERY
        : StockDocumentType.PURCHASE_RECEIPT;
    const date = (invoice.issuedAt ? new Date(invoice.issuedAt) : new Date()).toISOString().slice(0, 10);
    const document = await this.stockDocuments.insertDocument(
      invoice.tenantId,
      {
        docNumber: `${STOCK_DOCUMENT_PREFIX[docType]}-${invoice.id.replace(/-/g, '')}`.slice(0, 40),
        docType,
        status: 'POSTED' as never,
        docDate: date,
        fromWarehouseId: meta.lines[0].moved === 'OUT' ? invoice.warehouseId ?? null : null,
        toWarehouseId: meta.lines[0].moved === 'IN' ? invoice.warehouseId ?? null : null,
        reference: invoice.taxInvoiceNumber,
        sourceInvoiceId: invoice.id,
        postedAt: new Date(),
      },
      meta.lines.map((line) => ({
        itemId: null,
        sku: line.sku,
        quantity: original ? line.quantity : line.moved === 'IN' ? line.quantity : -line.quantity,
        unitCost: line.unitCost,
        value: line.value,
        batchNumber: null,
      })),
      manager,
    );
    return document.id;
  }

  /** Unit cost of a purchased line in rials: net of discount, converted at the invoice rate. */
  private purchaseUnitCost(invoice: InvoiceEntity, line: InvoiceItem): number {
    const netRial =
      (line.quantity * line.unitPrice - (line.discount ?? 0)) * this.resolveFxRate(invoice);
    return this.round(netRial / line.quantity);
  }

  /** Cost per unit the related sale recorded, by SKU (empty for legacy invoices). */
  private async relatedCosts(
    invoice: InvoiceEntity,
    manager: EntityManager,
  ): Promise<Map<string, number>> {
    const costs = new Map<string, number>();
    if (!invoice.relatedInvoiceId) {
      return costs;
    }
    const related = await this.invoicingRepository.findByIdForPosting(
      invoice.tenantId,
      invoice.relatedInvoiceId,
      manager,
    );
    for (const line of related?.postingMeta?.lines ?? []) {
      if (line.moved === 'OUT') {
        costs.set(line.sku, line.unitCost);
      }
    }
    return costs;
  }

  /** Puts stock back the way the document moved it, at the cost it recorded. */
  private async reverseStock(
    invoice: InvoiceEntity,
    manager: EntityManager,
  ): Promise<void> {
    const reference = `ابطال فاکتور ${invoice.taxInvoiceNumber}`;
    const meta = invoice.postingMeta;
    if (!meta) {
      // Invoices posted before costs were recorded: bring sold goods back at the selling price.
      const fxRate = this.resolveFxRate(invoice);
      for (const line of invoice.items ?? []) {
        if (!this.isLinkedLine(line)) {
          continue;
        }
        const unitCost = this.round(line.unitPrice * fxRate);
        await this.inventoryService.receiveStock(
          invoice.tenantId,
          {
            sku: line.sku,
            quantity: line.quantity,
            unitPurchaseCost: unitCost > 0 ? unitCost : 1,
            reference,
          },
          manager,
        );
      }
      return;
    }
    for (const line of meta.lines) {
      const warehouseId = line.warehouseId ?? undefined;
      if (line.moved === 'OUT') {
        await this.inventoryService.receiveStock(
          invoice.tenantId,
          {
            sku: line.sku,
            quantity: line.quantity,
            unitPurchaseCost: line.unitCost > 0 ? line.unitCost : 1,
            reference,
            ...(warehouseId ? { warehouseId } : {}),
          },
          manager,
        );
      } else {
        await this.inventoryService.issueStock(
          invoice.tenantId,
          {
            sku: line.sku,
            quantity: line.quantity,
            reference,
            ...(warehouseId ? { warehouseId } : {}),
          },
          manager,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Amounts and journal lines
  // ---------------------------------------------------------------------------

  /**
   * The signed amounts this document posts. An original posts its own totals, a return the
   * opposite of them, a corrective only the difference to the latest issued version it amends.
   */
  private async amountsFor(
    invoice: InvoiceEntity,
    manager: EntityManager,
  ): Promise<{ receivable: bigint; vat: bigint; net: bigint }> {
    const own = this.ownAmounts(invoice);
    switch (this.subjectOf(invoice)) {
      case InvoiceSubject.RETURN:
        return {
          receivable: -own.receivable,
          vat: -own.vat,
          net: -own.net,
        };
      case InvoiceSubject.CORRECTIVE: {
        const baseline = await this.correctiveBaseline(invoice, manager);
        return {
          receivable: own.receivable - baseline.receivable,
          vat: own.vat - baseline.vat,
          net: own.net - baseline.net,
        };
      }
      default:
        return own;
    }
  }

  /** What the invoice a corrective amends currently stands at (the original, or its last correction). */
  private async correctiveBaseline(
    invoice: InvoiceEntity,
    manager: EntityManager,
  ): Promise<{ receivable: bigint; vat: bigint; net: bigint }> {
    if (!invoice.relatedInvoiceId) {
      throw new Error(
        `Corrective invoice ${invoice.taxInvoiceNumber} has no related invoice.`,
      );
    }
    const siblings = await this.invoicingRepository.findCorrectives(
      invoice.tenantId,
      invoice.relatedInvoiceId,
      manager,
    );
    const earlier = siblings.filter(
      (other) =>
        other.id !== invoice.id &&
        other.journalEntryId !== null &&
        other.journalEntryId !== undefined &&
        other.reversalJournalEntryId == null &&
        other.status !== InvoiceStatus.CANCELLED &&
        new Date(other.createdAt) <= new Date(invoice.createdAt),
    );
    const base =
      earlier.length > 0
        ? earlier[earlier.length - 1]
        : await this.invoicingRepository.findByIdForPosting(
            invoice.tenantId,
            invoice.relatedInvoiceId,
            manager,
          );
    if (!base) {
      throw new Error(`Related invoice ${invoice.relatedInvoiceId} not found.`);
    }
    return this.ownAmounts(base);
  }

  /**
   * Rial amounts of an invoice in minor units. Tax reports (`invoiceRialAmounts`) must agree with
   * this exactly; the seasonal-report spec pins that.
   */
  private computeAmounts(invoice: InvoiceEntity): {
    receivableMinor: bigint;
    vatMinor: bigint;
    salesMinor: bigint;
  } {
    const own = this.ownAmounts(invoice);
    return {
      receivableMinor: own.receivable,
      vatMinor: own.vat,
      salesMinor: own.net,
    };
  }

  /** The invoice's own totals in rial minor units (receivable, VAT, net). */
  private ownAmounts(invoice: InvoiceEntity): {
    receivable: bigint;
    vat: bigint;
    net: bigint;
  } {
    const receivable = this.rialMinor(invoice, invoice.finalPayable);
    const vat = this.rialMinor(invoice, invoice.totalTax);
    const net = receivable - vat;
    if (net < 0n) {
      throw new Error(
        `Invoice ${invoice.taxInvoiceNumber}: VAT exceeds the payable amount.`,
      );
    }
    return { receivable, vat, net };
  }

  private fromMeta(meta: InvoicePostingMeta): PostedAmounts {
    const posted = meta.posted;
    if (!posted) {
      throw new Error('Posting meta has no posted amounts.');
    }
    return {
      receivable: BigInt(posted.receivable),
      vat: BigInt(posted.vat),
      net: BigInt(posted.net),
      stock: BigInt(posted.stock),
    };
  }

  /** The amounts recorded at posting; invoices posted before that are recomputed as originals. */
  private postedOf(invoice: InvoiceEntity): PostedAmounts {
    if (invoice.postingMeta?.posted) {
      return this.fromMeta(invoice.postingMeta);
    }
    return { ...this.ownAmounts(invoice), stock: 0n };
  }

  /**
   * Template and amounts of one document voucher, as signed debits (a negative debit is a credit):
   *   sale      AR +receivable, Sales -net, VAT payable -vat, Inventory +stock, COGS -stock
   *   purchase  Inventory +stock, Purchases +(net-stock), VAT credit +vat, AP -receivable
   * `reverse` mirrors every line, which is exactly what a cancellation books.
   */
  private documentRequest(
    invoice: InvoiceEntity,
    amounts: PostedAmounts,
    reverse: boolean,
  ): { docType: string; amounts: Record<string, bigint> } {
    const sale = this.directionOf(invoice) === InvoiceDirection.SALE;
    return {
      docType: documentDocType(sale, reverse),
      amounts: drCrAmounts(documentRows(sale, amounts, reverse)),
    };
  }

  /** One voucher through the posting rules engine; idempotent per invoice and document type. */
  private postVoucher(
    invoice: InvoiceEntity,
    suffix: string,
    date: string,
    description: string,
    request: { docType: string; amounts: Record<string, bigint> },
    overrides: RoleAccounts,
    manager: EntityManager,
  ) {
    return this.postingRules.post(
      invoice.tenantId,
      {
        docType: request.docType,
        sourceType: 'invoice',
        sourceId: invoice.id,
        date,
        amounts: request.amounts,
        description,
        entryNumber: this.entryNumber(invoice, suffix),
        overrides,
        // Sales name their customer on the receivable line; purchases name their supplier on the payable line.
        ...(() => {
          const partyCode =
            this.directionOf(invoice) === InvoiceDirection.PURCHASE
              ? invoice.sellerInfo?.partyCode
              : invoice.buyerInfo?.partyCode;
          return partyCode ? { partyCode } : {};
        })(),
      },
      manager,
    );
  }

  /**
   * Accounts per role: the ones resolved the legacy way (name match, else create 1201/4101/...), unless the
   * tenant mapped that role on the posting-rules settings page (cancel follows the issue mapping).
   */
  private async roleOverrides(
    invoice: InvoiceEntity,
    phase: 'issue' | 'cancel' | 'settle',
    accounts: Partial<AccountMap>,
  ): Promise<RoleAccounts> {
    const legacy: Partial<Record<PostingRole, string>> = {};
    for (const [key, role] of ROLE_LINKS) {
      const code = accounts[key];
      if (code) legacy[role] = code;
    }
    const sale = this.directionOf(invoice) === InvoiceDirection.SALE;
    const docType = `invoice.${sale ? 'sale' : 'purchase'}.${phase === 'cancel' ? 'issue' : phase}`;
    const described = (await this.postingRules.describe(invoice.tenantId)).find((d) => d.docType === docType);
    return mergeRoleAccounts(legacy, described);
  }

  /** Stock value pulled toward the net so it never exceeds it (rounding only). */
  private clampToward(stock: bigint, net: bigint): bigint {
    if (stock > 0n && stock > net) {
      return net > 0n ? net : 0n;
    }
    if (stock < 0n && stock < net) {
      return net < 0n ? net : 0n;
    }
    return stock;
  }

  /**
   * Resolves just the ledger accounts this document will touch (creating missing defaults), so a
   * service invoice never conjures stock accounts. Stock accounts are needed only when a linked
   * line moves stock.
   */
  private async resolveAccountMap(
    invoice: InvoiceEntity,
    phase: 'document' | 'payment',
    stockMoves: boolean,
  ): Promise<AccountPlan> {
    const sale = this.directionOf(invoice) === InvoiceDirection.SALE;
    const wanted: Array<[keyof AccountMap, InvoiceAccountSpec]> =
      phase === 'payment'
        ? [
            ...(!invoice.payments?.length || invoice.payments.some((p) => p.method !== 'CARD')
              ? ([['cash', CASH_BANK_ACCOUNT]] as Array<[keyof AccountMap, InvoiceAccountSpec]>)
              : []),
            ...(invoice.payments?.some((p) => p.method === 'CARD')
              ? ([['posClearing', POS_CLEARING_ACCOUNT]] as Array<[keyof AccountMap, InvoiceAccountSpec]>)
              : []),
            sale ? ['receivable', RECEIVABLE_ACCOUNT] : ['payable', PAYABLE_ACCOUNT],
          ]
        : sale
          ? [
              ['receivable', RECEIVABLE_ACCOUNT],
              ['sales', SALES_ACCOUNT],
              ['vat', VAT_ACCOUNT],
            ]
          : [
              ['payable', PAYABLE_ACCOUNT],
              ['vatReceivable', VAT_RECEIVABLE_ACCOUNT],
              ['purchases', PURCHASES_ACCOUNT],
            ];
    if (phase === 'document' && stockMoves) {
      wanted.push(['inventory', INVENTORY_ACCOUNT]);
      if (sale) {
        wanted.push(['cogs', COGS_ACCOUNT]);
      }
    }
    const accounts = await this.accountingService.listAccounts(invoice.tenantId);
    const plan: AccountPlan = { codes: {}, pending: {} };
    const claimed = new Set<string>();
    for (const [key, spec] of wanted) {
      const decision = decideRoleAccount(accounts, spec, claimed);
      plan.codes[key] = decision.code;
      if (decision.action === 'create') {
        claimed.add(decision.code);
        plan.pending[key] = { spec, code: decision.code };
      }
    }
    return plan;
  }

  /**
   * Creates the planned-but-missing accounts whose voucher line is non-zero, so a purchase of
   * stock-only lines never conjures 5201. Idempotent: an account that already exists (replay, or a
   * concurrent run) is kept; a tenant mapping that replaced the planned code needs nothing created.
   */
  private async ensurePlanned(
    invoice: InvoiceEntity,
    plan: AccountPlan,
    overrides: RoleAccounts,
    amounts: Record<string, bigint>,
  ): Promise<void> {
    // Voucher row names per role, as documentRows / settleRows name them.
    const rows: Record<keyof AccountMap, string[]> = {
      receivable: ['receivable', 'party'],
      payable: ['payable', 'party'],
      sales: ['sales'],
      vat: ['vat'],
      vatReceivable: ['vat'],
      inventory: ['stock'],
      cogs: ['cogs'],
      purchases: ['purchases'],
      cash: ['cash'],
      posClearing: ['card'],
    };
    const nonZero = (name: string) => (amounts[`${name}Dr`] ?? 0n) !== 0n || (amounts[`${name}Cr`] ?? 0n) !== 0n;
    const neededKeys: Array<keyof AccountMap> = [];
    for (const [key, role] of ROLE_LINKS) {
      const pending = plan.pending[key];
      if (pending && overrides[role] === pending.code && rows[key].some(nonZero)) neededKeys.push(key);
    }
    for (const key of neededKeys) {
      const { spec, code } = plan.pending[key]!;
      try {
        await this.accountingService.createAccount(invoice.tenantId, {
          code,
          name: spec.name,
          accountType: spec.accountType,
          currency: Currency.IRR,
        });
      } catch (error) {
        // Created meanwhile (replay or concurrent run): fine if it is there now, else surface it.
        const accounts = await this.accountingService.listAccounts(invoice.tenantId);
        if (!accounts.some((a) => a.code === code)) throw error;
      }
    }
  }

  /**
   * How the amount owed was settled, in rial minor units. Without recorded payments the whole
   * amount is one cash/bank settlement. With them, each method keeps its own amount and the last
   * one absorbs any rounding so the parts add up to exactly what is owed. A refund (negative
   * amount owed) is split the same way, with every part negative.
   */
  private splitPayments(invoice: InvoiceEntity, owed: bigint): Array<[string, bigint]> {
    const payments = invoice.payments ?? [];
    if (payments.length === 0) {
      return [['CASH', owed]];
    }
    // A return owes a negative amount: its recorded payments are refunds of that size.
    const sign = owed < 0n ? -1n : 1n;
    const parts: Array<[string, bigint]> = [];
    let assigned = 0n;
    payments.forEach((payment, index) => {
      const amount =
        index === payments.length - 1
          ? owed - assigned
          : sign * this.rialMinor(invoice, payment.amount);
      assigned += amount;
      parts.push([payment.method, amount]);
    });
    return parts;
  }

  /** Does posting this document move stock? (Correctives and unlinked lines never do.) */
  private movesStock(invoice: InvoiceEntity): boolean {
    return (
      this.subjectOf(invoice) !== InvoiceSubject.CORRECTIVE &&
      (invoice.items ?? []).some((line) => this.isLinkedLine(line))
    );
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

  /** Rial minor units: invoice-currency amount x fx rate (6 decimals), rounded half-up. */
  private rialMinor(invoice: InvoiceEntity, amount: number): bigint {
    const amountMinor = toMinor(this.round(Number(amount ?? 0)));
    const rate = parseScaled(this.resolveFxRate(invoice).toFixed(6), 6);
    const product = amountMinor * rate;
    const divisor = 1_000_000n;
    return (product + (product < 0n ? -divisor / 2n : divisor / 2n)) / divisor;
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

/** AccountMap key -> posting role. */
const ROLE_LINKS: ReadonlyArray<[keyof AccountMap, PostingRole]> = [
  ['receivable', 'receivable'],
  ['sales', 'revenue'],
  ['vat', 'vat_output'],
  ['inventory', 'inventory'],
  ['cogs', 'cogs'],
  ['payable', 'payable'],
  ['purchases', 'purchases'],
  ['vatReceivable', 'vat_input'],
  ['cash', 'cash'],
  ['posClearing', 'pos_clearing'],
];

/** The planned accounts per role; `pending` ones do not exist yet and are created on first use. */
interface AccountPlan {
  codes: Partial<AccountMap>;
  pending: Partial<Record<keyof AccountMap, { spec: InvoiceAccountSpec; code: string }>>;
}

interface AccountMap {
  receivable: string;
  sales: string;
  vat: string;
  cash: string;
  inventory: string;
  cogs: string;
  purchases: string;
  payable: string;
  vatReceivable: string;
  posClearing: string;
}
