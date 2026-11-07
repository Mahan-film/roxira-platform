import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { fromMinor, minorToDecimal, parseScaled, toMinor } from '../../../accounting/money';
import { CreateInvoiceDto, InvoiceItemDto } from '../../../invoicing/dto/create-invoice.dto';
import { InvoiceEntity, InvoiceItem } from '../../../invoicing/entities/invoice.entity';
import { InvoiceDirection, InvoiceSubject } from '../../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../../invoicing/enums/invoice-status.enum';
import { InvoicingRepository } from '../../../invoicing/repositories/invoicing.repository';
import { InvoicingService } from '../../../invoicing/services/invoicing.service';
import { InventoryService } from '../../../inventory/services/inventory.service';
import { StockDocumentsService } from '../../../inventory/services/stock-documents.service';
import { STOCK_INVENTORY_ACCOUNT } from '../../../inventory/constants/stock-accounts';
import { COGS_ACCOUNT } from '../../../invoicing/constants/suite-events.constants';
import { PostingRulesService } from '../../../posting_rules/services/posting-rules.service';
import { COGS_DOC_TYPE, COGS_ENTRY_PREFIX, hundredthsToNumber, unitCostMinor } from '../../delivery/delivery-math';
import { parseQuantityHundredths } from '../../sales-math';
import { CreateReturnDto, ReturnLineRequestDto, ReturnResponseDto } from '../dto/sales-return.dto';
import { LockedReturnLine, SalesReturnRepository } from '../repositories/sales-return.repository';

const QUANTITY_SCALE = 2;
/** Invoices carry one shared idempotency column; the prefix keeps return keys in their own namespace. */
const IDEMPOTENCY_PREFIX = 'RET-';
/** Source type of the COGS reversal voucher: one voucher per return invoice (sourceId = its id). */
const COGS_RETURN_SOURCE_TYPE = 'sales_return';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const INVALID_DATE = 'تاریخ برگشت نامعتبر است (YYYY-MM-DD).';
const INVALID_QUANTITY = 'مقدار برگشتی نامعتبر است (عدد مثبت با حداکثر دو رقم اعشار).';
const DUPLICATE_LINE = 'یک خط حواله بیش از یک بار در درخواست آمده است.';
const INVOICE_NOT_FOUND = 'صورتحساب یافت نشد.';
const NOT_A_DELIVERY_INVOICE = 'فقط صورتحساب فروش اصلی که از حواله تحویل صادر شده قابل برگشت است.';
const NOT_ISSUED = 'صورتحساب مرجع باید صادرشده باشد.';
const LINE_NOT_ON_INVOICE = (id: number) => `خط حواله ${id} به این صورتحساب تعلق ندارد.`;
const OVER_RETURN = (id: number, requested: string, open: string) =>
  `مقدار برگشتی خط ${id} (${requested}) بیش از باقی‌مانده قابل برگشت از این صورتحساب (${open}) است.`;
const KEY_TAKEN = 'این کلید ایدمپوتنسی قبلاً برای برگشت صورتحساب دیگری ثبت شده است.';

/** Pg unique violation (23505) whose constraint name contains `part`. */
function isUniqueViolationOn(error: unknown, part: string): boolean {
  const e = error as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  const code = e?.code ?? e?.driverError?.code;
  const constraint = (e?.constraint ?? e?.driverError?.constraint ?? '').toLowerCase();
  return code === '23505' && constraint.includes(part);
}

/** Hundredths as decimal text with two places, e.g. 200n -> "2.00". */
function scaledText(hundredths: bigint): string {
  const negative = hundredths < 0n;
  const abs = negative ? -hundredths : hundredths;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

interface RequestedLine {
  deliveryLineId: number;
  quantity: bigint;
}

interface PlannedReturn {
  line: LockedReturnLine;
  quantity: bigint;
  /** Unit cost of the delivery line in minor units (rial x 100): the cost the stock comes back at. */
  unitCostMinor: bigint;
  /** Stock value of this return line in minor units, round half up. */
  valueMinor: bigint;
  /** The original invoice line the return line mirrors (price and VAT rate are taken from it). */
  invoiceLine: InvoiceItem;
}

/**
 * Partial return of a delivery invoice (#565 T1 slice 5). One tenant transaction:
 *  1. lock the original invoice row (serialises returns of one sale) and re-check the idempotency key;
 *  2. lock the requested delivery lines `FOR UPDATE`; each must be billed on this invoice (400);
 *  3. refuse a quantity above what this invoice billed minus what its earlier returns took back (409);
 *  4. create the RETURN invoice through the invoicing service, with the price and VAT rate of the
 *     original invoice line, so revenue and VAT reverse at that rate, not today's. The invoice
 *     carries no SKU or item id, so the invoicing path moves no stock and posts no COGS itself;
 *  5. receive the stock at the delivery line's unit cost (delivery line lineCost / delivered qty);
 *  6. post the COGS reversal once per return, through the posting engine (source `sales_return`,
 *     id = the return invoice id), at the sum of those stock values;
 *  7. bump `returned_quantity` on the delivery lines and link the return to them.
 * A repeated key returns the stored return. A concurrent twin either waits on the invoice lock and
 * replays, or loses the idempotency unique index and replays after the rollback.
 */
@Injectable()
export class SalesReturnService {
  constructor(
    private readonly returns: SalesReturnRepository,
    private readonly invoicing: InvoicingService,
    private readonly invoicingRepository: InvoicingRepository,
    private readonly inventory: InventoryService,
    private readonly stockDocuments: StockDocumentsService,
    private readonly posting: PostingRulesService,
  ) {}

  async createReturn(tenantId: string, invoiceId: string, dto: CreateReturnDto, _userId?: string): Promise<ReturnResponseDto> {
    if (!DATE.test(dto.returnDate) || Number.isNaN(new Date(`${dto.returnDate}T00:00:00Z`).getTime())) {
      throw new BadRequestException(INVALID_DATE);
    }
    const requested = parseLines(dto.lines);
    const key = dto.idempotencyKey ? `${IDEMPOTENCY_PREFIX}${dto.idempotencyKey}` : null;
    const deferred: Array<() => Promise<void>> = [];
    let result: ReturnResponseDto;
    try {
      result = await this.returns.runInTransaction(tenantId, (manager) =>
        this.createInTransaction(tenantId, manager, invoiceId, dto, requested, key, deferred),
      );
    } catch (error) {
      if (key && isUniqueViolationOn(error, 'idempotency')) {
        const replay = await this.replayAfterRace(tenantId, invoiceId, key);
        if (replay) return replay;
      }
      throw error;
    }
    for (const send of deferred) {
      await send();
    }
    return result;
  }

  private async createInTransaction(
    tenantId: string,
    manager: EntityManager,
    invoiceId: string,
    dto: CreateReturnDto,
    requested: RequestedLine[],
    key: string | null,
    deferred: Array<() => Promise<void>>,
  ): Promise<ReturnResponseDto> {
    // 1. The original invoice, locked; a repeated key replays the return it already made.
    const original = await this.invoicingRepository.lockForReturn(tenantId, invoiceId, manager);
    if (!original) throw new NotFoundException(INVOICE_NOT_FOUND);
    if (key) {
      const existingId = await this.returns.findInvoiceIdByIdempotencyKey(tenantId, manager, key);
      if (existingId) return this.replayIn(tenantId, manager, invoiceId, existingId);
    }
    if (
      (original.direction ?? InvoiceDirection.SALE) !== InvoiceDirection.SALE ||
      (original.subject ?? InvoiceSubject.ORIGINAL) !== InvoiceSubject.ORIGINAL
    ) {
      throw new BadRequestException(NOT_A_DELIVERY_INVOICE);
    }
    if (original.status !== InvoiceStatus.ISSUED && original.status !== InvoiceStatus.PAID) {
      throw new BadRequestException(NOT_ISSUED);
    }

    // 2. Lines must be billed on this invoice; then the delivery lines are locked.
    const links = await this.returns.linksOfInvoice(tenantId, manager, invoiceId);
    const linkByLine = new Map(links.map((link) => [link.deliveryLineId, link]));
    for (const line of requested) {
      if (!linkByLine.has(line.deliveryLineId)) throw new BadRequestException(LINE_NOT_ON_INVOICE(line.deliveryLineId));
    }
    const locked = await this.returns.lockDeliveryLines(
      tenantId,
      manager,
      requested.map((line) => line.deliveryLineId),
    );
    const lineById = new Map(locked.map((line) => [line.id, line]));

    // 3. Quantity: billed on this invoice minus returned against it by earlier returns.
    const returnedHere = await this.returns.returnedOnInvoice(
      tenantId,
      manager,
      invoiceId,
      InvoiceSubject.RETURN,
      InvoiceStatus.CANCELLED,
    );
    const plan: PlannedReturn[] = requested.map((req) => {
      const line = lineById.get(req.deliveryLineId);
      const link = linkByLine.get(req.deliveryLineId);
      if (!line || !link) throw new BadRequestException(LINE_NOT_ON_INVOICE(req.deliveryLineId));
      const billed = parseScaled(link.quantity, QUANTITY_SCALE);
      const open = billed - (returnedHere.get(req.deliveryLineId) ?? 0n);
      if (req.quantity > open) {
        throw new ConflictException(OVER_RETURN(req.deliveryLineId, scaledText(req.quantity), scaledText(open)));
      }
      const invoiceLine = original.items?.[link.invoiceLineNo - 1];
      if (!invoiceLine) throw new BadRequestException(LINE_NOT_ON_INVOICE(req.deliveryLineId));

      const deliveredHundredths = parseScaled(line.quantity, QUANTITY_SCALE);
      const perUnit = unitCostMinor(toMinor(line.lineCost), deliveredHundredths);
      // value = unit cost (minor per unit) x quantity (hundredths) / 100, round half up
      const valueMinor = (perUnit * req.quantity + 50n) / 100n;
      return { line, quantity: req.quantity, unitCostMinor: perUnit, valueMinor, invoiceLine };
    });

    // 4. The RETURN invoice, through the invoicing service (revenue and VAT reversal follow its path).
    const created = await this.invoicing.create(
      tenantId,
      this.returnInvoiceDto(original, invoiceId, plan),
      {
        idempotencyKey: key ?? undefined,
        issuedAt: new Date(`${dto.returnDate}T00:00:00+03:30`),
        manager,
        deferEvents: deferred,
      },
    );

    await this.returns.insertReturnLinks(
      tenantId,
      manager,
      created.id,
      plan.map((p, index) => ({
        deliveryId: p.line.deliveryId,
        deliveryLineId: p.line.id,
        orderLineId: p.line.orderLineId,
        invoiceLineNo: index + 1,
        quantity: scaledText(p.quantity),
      })),
    );

    // 5. Stock back at the delivery line's unit cost; 7. returned quantity on the delivery line.
    let cogsMinor = 0n;
    for (const p of plan) {
      await this.inventory.receiveStock(
        tenantId,
        {
          sku: p.line.sku,
          quantity: hundredthsToNumber(p.quantity),
          unitPurchaseCost: Number(minorToDecimal(p.unitCostMinor)),
          warehouseId: p.line.warehouseId,
          reference: `برگشت از حواله ${p.line.deliveryNumber}`,
          receivedAt: dto.returnDate,
        },
        manager,
      );
      await this.returns.bumpReturned(tenantId, manager, p.line.id, scaledText(p.quantity));
      cogsMinor += p.valueMinor;
    }

    // 6. COGS reversal through the posting engine, once per return.
    if (cogsMinor > 0n) {
      const [inventoryCode, cogsCode] = await this.stockDocuments.resolveAccounts(tenantId, [
        STOCK_INVENTORY_ACCOUNT,
        COGS_ACCOUNT,
      ]);
      await this.posting.post(
        tenantId,
        {
          docType: COGS_DOC_TYPE,
          sourceType: COGS_RETURN_SOURCE_TYPE,
          sourceId: created.id,
          date: dto.returnDate,
          amounts: { cost: cogsMinor },
          description: `ابطال بهای تمام‌شده برگشت ${created.taxInvoiceNumber}`,
          entryNumber: `${COGS_ENTRY_PREFIX}R-${created.taxInvoiceNumber}`.slice(0, 64),
          // The template debits `cogs` and credits `inventory`; swapping the accounts reverses it.
          overrides: { cogs: inventoryCode, inventory: cogsCode },
        },
        manager,
      );
    }

    return {
      id: created.id,
      taxInvoiceNumber: created.taxInvoiceNumber,
      relatedInvoiceId: invoiceId,
      items: plan.map((p) => ({ deliveryLineId: p.line.id, quantity: hundredthsToNumber(p.quantity) })),
      finalPayable: created.finalPayable,
      status: created.status,
    };
  }

  /**
   * The RETURN invoice. Items mirror the original lines at their stored unit price and VAT rate,
   * with the discount in proportion to the returned quantity. No SKU or item id on purpose: the
   * invoicing path would otherwise move stock and post COGS for the line again.
   */
  private returnInvoiceDto(original: InvoiceEntity, invoiceId: string, plan: PlannedReturn[]): CreateInvoiceDto {
    const items: InvoiceItemDto[] = plan.map((p) => {
      const line = p.invoiceLine;
      const billed = parseScaled(String(line.quantity), QUANTITY_SCALE);
      const discountMinor = toMinor(line.discount ?? 0);
      const returnedDiscount = billed > 0n ? (discountMinor * p.quantity + billed / 2n) / billed : 0n;
      return {
        description: line.description,
        quantity: hundredthsToNumber(p.quantity),
        unitPrice: Number(fromMinor(toMinor(line.unitPrice))),
        discount: Number(fromMinor(returnedDiscount)),
        vatRate: line.vatRate,
      };
    });
    return {
      subject: InvoiceSubject.RETURN,
      relatedInvoiceId: invoiceId,
      direction: InvoiceDirection.SALE,
      einvoiceType: original.einvoiceType,
      sellerInfo: original.sellerInfo,
      buyerInfo: original.buyerInfo ?? undefined,
      customerId: original.customerId ?? undefined,
      warehouseId: original.warehouseId ?? undefined,
      currency: original.currency,
      jurisdiction: original.jurisdiction,
      fxRate: Number(original.fxRate),
      status: InvoiceStatus.ISSUED,
      items,
    } as CreateInvoiceDto;
  }

  /** Repeated key after a unique violation: replay in a fresh transaction, or nothing if it vanished. */
  private async replayAfterRace(tenantId: string, invoiceId: string, key: string): Promise<ReturnResponseDto | null> {
    return this.returns.runInTransaction(tenantId, async (manager) => {
      const id = await this.returns.findInvoiceIdByIdempotencyKey(tenantId, manager, key);
      return id ? this.replayIn(tenantId, manager, invoiceId, id) : null;
    });
  }

  /** The stored return of a key, with the same original invoice; another invoice's key is a conflict. */
  private async replayIn(
    tenantId: string,
    manager: EntityManager,
    invoiceId: string,
    returnId: string,
  ): Promise<ReturnResponseDto> {
    const invoice = await manager.findOne(InvoiceEntity, { where: { id: returnId, tenantId } });
    if (!invoice || invoice.relatedInvoiceId !== invoiceId) throw new ConflictException(KEY_TAKEN);
    const links = await this.returns.linksOfInvoice(tenantId, manager, returnId);
    return {
      id: invoice.id,
      taxInvoiceNumber: invoice.taxInvoiceNumber,
      relatedInvoiceId: invoiceId,
      items: links.map((link) => ({
        deliveryLineId: link.deliveryLineId,
        quantity: Number(link.quantity),
      })),
      finalPayable: Number(invoice.finalPayable),
      status: invoice.status,
    };
  }
}

/** Validates the request lines before anything is locked or written. */
function parseLines(lines: ReturnLineRequestDto[]): RequestedLine[] {
  if (new Set(lines.map((line) => line.deliveryLineId)).size !== lines.length) {
    throw new BadRequestException(DUPLICATE_LINE);
  }
  return lines.map((line) => {
    let quantity: bigint;
    try {
      quantity = parseQuantityHundredths(line.quantity);
    } catch {
      throw new BadRequestException(INVALID_QUANTITY);
    }
    if (quantity <= 0n) throw new BadRequestException(INVALID_QUANTITY);
    return { deliveryLineId: line.deliveryLineId, quantity };
  });
}
