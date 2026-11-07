import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { fromMinor, Money, parseMinor, parseScaled } from '../../../accounting/money';
import { Currency } from '../../../currency/enums/currency.enum';
import { TenantsRepository } from '../../../tenants/repositories/tenants.repository';
import { CreateInvoiceDto } from '../../../invoicing/dto/create-invoice.dto';
import { InvoicingService } from '../../../invoicing/services/invoicing.service';
import { InvoiceStatus } from '../../../invoicing/enums/invoice-status.enum';
import { VatRateResolver } from '../../../invoicing/services/vat-rate.resolver';
import { InvoicingRepository } from '../../../invoicing/repositories/invoicing.repository';
import { tehranIsoDate } from '../../../hr/services/jalali-period';
import { SalesDeliveryRepository } from '../repositories/sales-delivery.repository';
import {
  InvoiceDeliveryLinkRow,
  LockedDeliveryLine,
  SalesInvoiceDeliveryRepository,
} from '../repositories/sales-invoice-delivery.repository';
import { fulfilmentStatus, hundredthsToNumber, overallFulfilmentStatus } from '../delivery-math';
import { parseQuantityHundredths } from '../../sales-math';
import {
  CreateInvoiceFromDeliveryDto,
  InvoiceDeliveryLinkResponseDto,
  InvoiceFromDeliveryLineDto,
  InvoiceFromDeliveryResponseDto,
  OrderInvoicingLineResponseDto,
  OrderInvoicingResponseDto,
} from '../dto/sales-invoice-from-delivery.dto';

const QUANTITY_SCALE = 2;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Invoices carry one shared idempotency column; the prefix keeps delivery keys in their own namespace. */
const IDEMPOTENCY_PREFIX = 'DINV-';

const DUPLICATE_LINE = 'یک سطر حواله بیش از یک بار در درخواست آمده است.';
const INVALID_QUANTITY = 'مقدار صورتحساب نامعتبر است (حداکثر دو رقم اعشار و بزرگ‌تر از صفر).';
const INVALID_DATE = 'تاریخ صورتحساب نامعتبر است (YYYY-MM-DD).';
const LINE_NOT_FOUND = (id: number) => `سطر حواله با شناسه ${id} یافت نشد.`;
const MIXED_CUSTOMERS = 'همهٔ سطرهای یک صورتحساب باید از حواله‌های یک مشتری باشند.';
const OVER_INVOICING = (lineId: number, requested: string, remaining: string) =>
  `مقدار درخواستی سطر ${lineId} (${requested}) بیش از باقی‌ماندهٔ قابل صورتحساب آن (${remaining}) است.`;
const PARTY_NOT_FOUND = (code: string) => `طرف حساب با کد ${code} یافت نشد.`;
const UNIT_PRICE_TOO_LARGE = 'قیمت واحد سفارش برای محاسبهٔ دقیق صورتحساب بیش از حد مجاز است.';
const ORDER_NOT_FOUND = (id: number) => `سفارش با شناسه ${id} یافت نشد.`;
const INVOICE_NOT_FOUND = 'صورتحساب یافت نشد.';

/** Pg unique violation (23505) whose constraint name contains `part`. */
function isUniqueViolationOn(error: unknown, part: string): boolean {
  const e = error as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  const code = e?.code ?? e?.driverError?.code;
  const constraint = (e?.constraint ?? e?.driverError?.constraint ?? '').toLowerCase();
  return code === '23505' && constraint.includes(part);
}

/** The invoice fields the response repeats; both the entity and the response DTO carry them. */
interface InvoiceSummary {
  id: string;
  taxInvoiceNumber: string;
  status: string;
  totalAmount: Money;
  totalTax: Money;
  finalPayable: Money;
}

/** A stored or fresh money amount as the response carries it: exact, via `money.ts` (no float maths). */
function moneyOut(value: Money): Money {
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  return fromMinor(parseMinor(text));
}

/** One planned invoice line: a locked delivery line, its quantity, its price and its description. */
interface PlannedLine {
  deliveryLine: LockedDeliveryLine;
  requested: bigint;
  unitPriceMinor: bigint;
  description: string;
}

/**
 * Invoicing from delivery notes (#563 T1 slice 4): one invoice over lines of several deliveries
 * of ONE customer. In one tenant transaction the delivery lines are locked `FOR UPDATE`, every
 * quantity is checked against `quantity - invoiced_quantity` (409 above it), the invoice is
 * created through the existing invoicing service (so revenue and VAT follow its existing path and
 * the VAT rate comes from the statutory store on the invoice date), `invoiced_quantity` is bumped
 * and every invoice line is linked to its delivery line in `erp_sales_invoice_delivery_lines`.
 * The delivery already moved the stock and posted the COGS, so the invoice lines carry no stock
 * link: posting books revenue and VAT only, never stock or COGS again. The status event is queued
 * only after the transaction commits, so posting never runs against an uncommitted invoice.
 */
@Injectable()
export class SalesInvoiceFromDeliveryService {
  constructor(
    private readonly invoices: SalesInvoiceDeliveryRepository,
    private readonly deliveries: SalesDeliveryRepository,
    private readonly invoicing: InvoicingService,
    private readonly invoicingRepository: InvoicingRepository,
    private readonly vatRates: VatRateResolver,
    @Optional() private readonly tenantsRepository?: TenantsRepository,
  ) {}

  /**
   * Creates the invoice inside one tenant transaction. A unique violation on the idempotency key
   * (a concurrent twin request that won the partial unique index) returns the stored invoice.
   */
  async createFromDeliveries(
    tenantId: string,
    dto: CreateInvoiceFromDeliveryDto,
  ): Promise<InvoiceFromDeliveryResponseDto> {
    const key = dto.idempotencyKey ? `${IDEMPOTENCY_PREFIX}${dto.idempotencyKey}` : null;
    const deferred: Array<() => Promise<void>> = [];
    let result: InvoiceFromDeliveryResponseDto;
    try {
      result = await this.invoices.runInTransaction(tenantId, (manager) =>
        this.createInTransaction(tenantId, manager, dto, key, deferred),
      );
    } catch (error) {
      if (key && isUniqueViolationOn(error, 'idempotency')) {
        const replay = await this.replayResponse(tenantId, key);
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
    dto: CreateInvoiceFromDeliveryDto,
    key: string | null,
    deferred: Array<() => Promise<void>>,
  ): Promise<InvoiceFromDeliveryResponseDto> {
    if (!DATE.test(dto.invoiceDate) || Number.isNaN(new Date(`${dto.invoiceDate}T00:00:00Z`).getTime())) {
      throw new BadRequestException(INVALID_DATE);
    }
    const requested = this.parseLines(dto.deliveryLines);
    const locked = await this.invoices.lockDeliveryLines(
      tenantId,
      manager,
      requested.map((line) => line.deliveryLineId),
    );
    const byId = new Map(locked.map((line) => [line.id, line]));
    const missing = requested.find((line) => !byId.has(line.deliveryLineId));
    if (missing) throw new NotFoundException(LINE_NOT_FOUND(missing.deliveryLineId));

    if (key) {
      const existingId = await this.invoices.findInvoiceIdByIdempotencyKey(tenantId, manager, key);
      if (existingId) return this.replayOf(tenantId, existingId, manager);
    }

    const plan = this.planLines(requested, byId);
    const invoiceDto = await this.buildInvoiceDto(tenantId, manager, dto, plan);
    const invoice = await this.invoicing.create(tenantId, invoiceDto, {
      idempotencyKey: key ?? undefined,
      issuedAt: new Date(`${dto.invoiceDate}T00:00:00+03:30`),
      manager,
      deferEvents: deferred,
    });

    await this.invoices.insertLinks(
      tenantId,
      manager,
      invoice.id,
      plan.map((line, index) => ({
        deliveryId: line.deliveryLine.deliveryId,
        deliveryLineId: line.deliveryLine.id,
        orderLineId: line.deliveryLine.orderLineId,
        invoiceLineNo: index + 1,
        quantity: scaledText(line.requested),
      })),
    );
    for (const line of plan) {
      await this.invoices.bumpDeliveryInvoiced(tenantId, manager, line.deliveryLine.id, scaledText(line.requested));
      await this.invoices.bumpOrderInvoiced(tenantId, manager, line.deliveryLine.orderLineId, scaledText(line.requested));
    }

    const links = await this.invoices.linksOfInvoiceWith(tenantId, manager, invoice.id);
    return this.toResponse(dto.invoiceDate, links[0]?.partyCode ?? '', invoice, links, false);
  }

  /** Validates every line before anything is written, so a refusal changes nothing. */
  private parseLines(lines: InvoiceFromDeliveryLineDto[]): Array<{ deliveryLineId: number; requested: bigint }> {
    if (new Set(lines.map((line) => line.deliveryLineId)).size !== lines.length) {
      throw new BadRequestException(DUPLICATE_LINE);
    }
    return lines.map((line) => {
      let requested: bigint;
      try {
        requested = parseQuantityHundredths(line.quantity);
      } catch {
        throw new BadRequestException(INVALID_QUANTITY);
      }
      return { deliveryLineId: line.deliveryLineId, requested };
    });
  }

  /** One customer across every delivery, and no line above its remaining invoiceable quantity. */
  private planLines(
    requested: Array<{ deliveryLineId: number; requested: bigint }>,
    byId: Map<number, LockedDeliveryLine>,
  ): PlannedLine[] {
    if (new Set(requested.map((line) => byId.get(line.deliveryLineId)!.partyCode)).size !== 1) {
      throw new BadRequestException(MIXED_CUSTOMERS);
    }
    return requested.map((line) => {
      const deliveryLine = byId.get(line.deliveryLineId)!;
      const remaining =
        parseScaled(deliveryLine.quantity, QUANTITY_SCALE) -
        parseScaled(deliveryLine.invoicedQuantity, QUANTITY_SCALE);
      if (line.requested > remaining) {
        throw new ConflictException(
          OVER_INVOICING(deliveryLine.id, scaledText(line.requested), scaledText(remaining)),
        );
      }
      return { deliveryLine, requested: line.requested, unitPriceMinor: 0n, description: deliveryLine.sku };
    });
  }

  /** Seller, buyer, prices from the order lines and the statutory VAT rate of the invoice date. */
  private async buildInvoiceDto(
    tenantId: string,
    manager: EntityManager,
    dto: CreateInvoiceFromDeliveryDto,
    plan: PlannedLine[],
  ): Promise<CreateInvoiceDto> {
    const orderLines = await this.invoices.orderLinesByIds(
      tenantId,
      manager,
      plan.map((line) => line.deliveryLine.orderLineId),
    );
    const itemNames = await this.invoices.itemNamesByIds(
      tenantId,
      manager,
      [...new Set(plan.map((line) => line.deliveryLine.itemId))],
    );
    for (const line of plan) {
      const orderLine = orderLines.get(line.deliveryLine.orderLineId);
      if (!orderLine) throw new NotFoundException(LINE_NOT_FOUND(line.deliveryLine.id));
      const unitPriceMinor = parseMinor(orderLine.unitPrice);
      if (unitPriceMinor < 0n || typeof fromMinor(unitPriceMinor) === 'string') {
        throw new BadRequestException(UNIT_PRICE_TOO_LARGE);
      }
      line.unitPriceMinor = unitPriceMinor;
      line.description =
        itemNames.get(line.deliveryLine.itemId) ?? orderLine.description ?? line.deliveryLine.sku;
    }

    const partyCode = plan[0].deliveryLine.partyCode;
    const partyName = await this.invoices.partyNameByCode(tenantId, manager, partyCode);
    if (!partyName) throw new NotFoundException(PARTY_NOT_FOUND(partyCode));
    const { rate } = await this.vatRates.generalRate(tenantId, dto.invoiceDate);
    const sellerName = (await this.tenantsRepository?.findById(tenantId))?.name?.trim() || 'سازمان من';

    return {
      sellerInfo: { name: sellerName },
      // partyCode is internal (not on the public DTO): posting carries it on the receivable line.
      buyerInfo: { name: partyName, partyCode } as CreateInvoiceDto['buyerInfo'],
      currency: Currency.IRR,
      status: InvoiceStatus.ISSUED,
      // No itemId/sku on purpose: the delivery moved the stock, so posting must not move it again.
      items: plan.map((line) => ({
        description: line.description,
        quantity: hundredthsToNumber(line.requested),
        unitPrice: fromMinor(line.unitPriceMinor) as number,
        vatRate: rate,
      })),
    };
  }

  /** The invoice a repeated idempotency key returns: the same invoice with its delivery links. */
  private async replayResponse(tenantId: string, key: string): Promise<InvoiceFromDeliveryResponseDto | null> {
    return this.invoices.runInTransaction(tenantId, async (manager) => {
      const id = await this.invoices.findInvoiceIdByIdempotencyKey(tenantId, manager, key);
      return id ? this.replayOf(tenantId, id, manager) : null;
    });
  }

  private async replayOf(
    tenantId: string,
    invoiceId: string,
    manager?: EntityManager,
  ): Promise<InvoiceFromDeliveryResponseDto> {
    const invoice = await this.invoicingRepository.findById(tenantId, invoiceId);
    if (!invoice) throw new NotFoundException(INVOICE_NOT_FOUND);
    const links = manager
      ? await this.invoices.linksOfInvoiceWith(tenantId, manager, invoiceId)
      : await this.invoices.linksOfInvoice(tenantId, invoiceId);
    return this.toResponse(
      tehranIsoDate(invoice.issuedAt ?? invoice.createdAt),
      links[0]?.partyCode ?? '',
      invoice,
      links,
      true,
    );
  }

  private toResponse(
    invoiceDate: string,
    partyCode: string,
    invoice: InvoiceSummary,
    links: InvoiceDeliveryLinkRow[],
    replayed: boolean,
  ): InvoiceFromDeliveryResponseDto {
    return {
      invoiceId: invoice.id,
      taxInvoiceNumber: invoice.taxInvoiceNumber,
      status: String(invoice.status),
      partyCode,
      invoiceDate,
      // The stored numeric(18,2) comes back as text on a replay and as a number on a fresh save;
      // both go through the same exact conversion so the response is identical either way.
      totalAmount: moneyOut(invoice.totalAmount),
      totalTax: moneyOut(invoice.totalTax),
      finalPayable: moneyOut(invoice.finalPayable),
      replayed,
      lines: links.map((link) => this.toLinkResponse(link)),
    };
  }

  private toLinkResponse(link: InvoiceDeliveryLinkRow): InvoiceDeliveryLinkResponseDto {
    return {
      deliveryId: link.deliveryId,
      deliveryNumber: link.deliveryNumber,
      deliveryLineId: link.deliveryLineId,
      orderLineId: link.orderLineId,
      itemId: link.itemId,
      sku: link.sku,
      invoiceLineNo: link.invoiceLineNo,
      quantity: hundredthsToNumber(parseScaled(link.quantity, QUANTITY_SCALE)),
    };
  }

  /**
   * Invoicing state of an order, line by line: ordered, delivered, invoiced and what is left to
   * invoice. The order line carries all three quantities; the invoiced column is kept in step
   * with the delivery lines by the invoice transaction itself.
   */
  async getOrderInvoicing(tenantId: string, orderId: number): Promise<OrderInvoicingResponseDto> {
    return this.invoices.runInTransaction(tenantId, async (manager) => {
      const found = await this.deliveries.findOrderWithLines(tenantId, manager, orderId);
      if (!found) throw new NotFoundException(ORDER_NOT_FOUND(orderId));
      const lines: OrderInvoicingLineResponseDto[] = found.lines.map((line) => {
        const ordered = parseScaled(line.quantity, QUANTITY_SCALE);
        const delivered = parseScaled(line.deliveredQuantity, QUANTITY_SCALE);
        const invoiced = parseScaled(line.invoicedQuantity, QUANTITY_SCALE);
        const remaining = delivered - invoiced;
        return {
          orderLineId: line.id,
          itemId: line.itemId,
          ordered: hundredthsToNumber(ordered),
          delivered: hundredthsToNumber(delivered),
          invoiced: hundredthsToNumber(invoiced),
          remaining: hundredthsToNumber(remaining),
          status: fulfilmentStatus(invoiced, delivered),
        };
      });
      return {
        orderId,
        status: overallFulfilmentStatus(lines.map((line) => line.status)),
        lines,
      };
    });
  }
}

/** Hundredths as a decimal text with two places, e.g. 400n -> "4.00". */
function scaledText(hundredths: bigint): string {
  const negative = hundredths < 0n;
  const abs = negative ? -hundredths : hundredths;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}
