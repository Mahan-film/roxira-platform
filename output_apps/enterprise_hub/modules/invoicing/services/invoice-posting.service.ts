import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { minorToDecimal, parseScaled, toMinor } from '../../accounting/money';
import { AccountResponseDto } from '../../accounting/dto/account-response.dto';
import { JournalEntryLineDto } from '../../accounting/dto/create-journal-entry.dto';
import { AccountingService } from '../../accounting/services/accounting.service';
import { Currency } from '../../currency/enums/currency.enum';
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
      // Accounts are resolved (and created if missing) before the transaction: that step is
      // idempotent and must not be rolled back together with a failed posting.
      const accounts = await this.resolveAccountMap(
        invoice,
        'document',
        this.movesStock(invoice),
      );
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
        const entry = await this.accountingService.createJournalEntry(
          locked.tenantId,
          {
            entryNumber: this.entryNumber(locked, 'ISSUED'),
            date: this.entryDate(locked.issuedAt),
            description: `صدور صورتحساب ${locked.taxInvoiceNumber}`,
            lines: this.documentLines(locked, this.fromMeta(meta), accounts, false),
          },
          manager,
        );
        await this.invoicingRepository.updatePosting(
          locked.tenantId,
          locked.id,
          { journalEntryId: entry.id, postingError: null, postingMeta: meta },
          manager,
        );
      });
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
      const accounts = await this.resolveAccountMap(invoice, 'payment', false);
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
        const sign = sale ? 1n : -1n;
        const split = this.splitPayments(locked, owed);
        const lines = this.toLines([
          ...split.map(([method, amount]): [string, bigint, string] => [
            method === 'CARD' ? accounts.posClearing : accounts.cash,
            sign * amount,
            sale
              ? method === 'CARD'
                ? 'دریافت از طریق پوز'
                : 'دریافت نقدی/بانکی بابت صورتحساب'
              : 'پرداخت نقدی/بانکی بابت صورتحساب',
          ]),
          [
            sale ? accounts.receivable : accounts.payable,
            -sign * owed,
            sale ? 'تسویه حساب‌های دریافتنی' : 'تسویه حساب‌های پرداختنی',
          ],
        ]);
        const entry = await this.accountingService.createJournalEntry(
          locked.tenantId,
          {
            entryNumber: this.entryNumber(locked, 'PAID'),
            date: this.entryDate(locked.paidAt ?? locked.issuedAt),
            description: `تسویه صورتحساب ${locked.taxInvoiceNumber}`,
            lines,
          },
          manager,
        );
        await this.invoicingRepository.updatePosting(
          locked.tenantId,
          locked.id,
          { paidJournalEntryId: entry.id, postingError: null },
          manager,
        );
      });
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
      const accounts = await this.resolveAccountMap(
        invoice,
        'document',
        (invoice.postingMeta?.lines.length ?? 0) > 0 ||
          (!invoice.postingMeta && this.movesStock(invoice)),
      );

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
        const entry = await this.accountingService.createJournalEntry(
          locked.tenantId,
          {
            entryNumber: this.entryNumber(locked, 'CANCEL'),
            date: this.entryDate(locked.issuedAt),
            description: `ابطال صورتحساب ${locked.taxInvoiceNumber}`,
            lines: this.documentLines(locked, posted, accounts, true),
          },
          manager,
        );
        await this.invoicingRepository.updatePosting(
          locked.tenantId,
          locked.id,
          { reversalJournalEntryId: entry.id, postingError: null },
          manager,
        );
      });
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
   * Journal lines for one document, as signed debits (a negative debit is a credit):
   *   sale      AR +receivable, Sales -net, VAT payable -vat, Inventory +stock, COGS -stock
   *   purchase  Inventory +stock, Purchases +(net-stock), VAT credit +vat, AP -receivable
   * `reverse` mirrors every line, which is exactly what a cancellation books.
   */
  private documentLines(
    invoice: InvoiceEntity,
    amounts: PostedAmounts,
    accounts: AccountMap,
    reverse: boolean,
  ): JournalEntryLineDto[] {
    const sign = reverse ? -1n : 1n;
    const sale = this.directionOf(invoice) === InvoiceDirection.SALE;
    const rows: Array<[string, bigint, string]> = sale
      ? [
          [accounts.receivable, amounts.receivable, `صدور صورتحساب ${invoice.taxInvoiceNumber}`],
          [accounts.sales, -amounts.net, 'درآمد فروش'],
          [accounts.vat, -amounts.vat, 'مالیات بر ارزش افزوده پرداختنی'],
          [accounts.inventory, amounts.stock, 'تغییر موجودی کالا'],
          [accounts.cogs, -amounts.stock, 'بهای تمام‌شده کالای فروش‌رفته'],
        ]
      : [
          [accounts.inventory, amounts.stock, 'ورود کالا به انبار'],
          [accounts.purchases, amounts.net - amounts.stock, 'خرید کالا و خدمات'],
          [accounts.vatReceivable, amounts.vat, 'مالیات بر ارزش افزوده خرید'],
          [accounts.payable, -amounts.receivable, `بدهی بابت صورتحساب ${invoice.taxInvoiceNumber}`],
        ];
    return this.toLines(rows.map(([code, debit, text]) => [code, debit * sign, text]));
  }

  /** Signed debits to ledger lines; zero amounts are dropped. */
  private toLines(rows: Array<[string, bigint, string]>): JournalEntryLineDto[] {
    const lines: JournalEntryLineDto[] = [];
    for (const [accountCode, debit, description] of rows) {
      if (debit > 0n) {
        lines.push({ accountCode, debit: minorToDecimal(debit), description });
      } else if (debit < 0n) {
        lines.push({ accountCode, credit: minorToDecimal(-debit), description });
      }
    }
    // Debits first, then credits (stable): the order a bookkeeper reads a voucher in.
    return [
      ...lines.filter((line) => line.debit !== undefined),
      ...lines.filter((line) => line.debit === undefined),
    ];
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
  ): Promise<AccountMap> {
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
    const codes = await this.resolveAccounts(
      invoice.tenantId,
      wanted.map(([, spec]) => spec),
    );
    const map: Partial<AccountMap> = {};
    wanted.forEach(([key], index) => {
      map[key] = codes[index];
    });
    return map as AccountMap;
  }

  /**
   * How the amount owed was settled, in rial minor units. Without recorded payments the whole
   * amount is one cash/bank settlement. With them, each method keeps its own amount and the last
   * one absorbs any rounding so the parts add up to exactly what is owed.
   */
  private splitPayments(invoice: InvoiceEntity, owed: bigint): Array<[string, bigint]> {
    const payments = invoice.payments ?? [];
    if (payments.length === 0) {
      return [['CASH', owed]];
    }
    const parts: Array<[string, bigint]> = [];
    let assigned = 0n;
    payments.forEach((payment, index) => {
      const amount =
        index === payments.length - 1
          ? owed - assigned
          : this.rialMinor(invoice, payment.amount);
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
