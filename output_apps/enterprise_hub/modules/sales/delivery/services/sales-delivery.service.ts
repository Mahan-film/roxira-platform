import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { InventoryService } from '../../../inventory/services/inventory.service';
import { StockDocumentsService } from '../../../inventory/services/stock-documents.service';
import { StockDocumentsRepository } from '../../../inventory/repositories/stock-documents.repository';
import { StockDocumentType, StockDocumentStatus } from '../../../inventory/enums/stock-document.enum';
import { STOCK_INVENTORY_ACCOUNT } from '../../../inventory/constants/stock-accounts';
import { COGS_ACCOUNT } from '../../../invoicing/constants/suite-events.constants';
import { PostingRulesService } from '../../../posting_rules/services/posting-rules.service';
import { fromMinor, minorToDecimal, parseScaled, toMinor } from '../../../accounting/money';
import { SalesOrderEntity, SalesOrderLineEntity } from '../../entities/sales-order.entity';
import { SalesOrderStatus } from '../../enums/sales-status.enum';
import { SalesRepository } from '../../repositories/sales.repository';
import { parseQuantityHundredths } from '../../sales-math';
import { SalesDeliveryEntity, SalesDeliveryLineEntity } from '../entities/sales-delivery.entity';
import { SalesDeliveryRepository, NewDeliveryLine } from '../repositories/sales-delivery.repository';
import {
  COGS_DOC_TYPE,
  COGS_ENTRY_PREFIX,
  COGS_SOURCE_TYPE,
  DELIVERY_NUMBER_PREFIX,
  fulfilmentStatus,
  hundredthsToNumber,
  overallFulfilmentStatus,
  unitCostMinor,
} from '../delivery-math';
import {
  BackorderListResponseDto,
  CreateSalesDeliveryDto,
  DeliveryLineDto,
  OrderFulfilmentResponseDto,
  QueryBackordersDto,
  QuerySalesDeliveryDto,
  SalesDeliveryListResponseDto,
  SalesDeliveryResponseDto,
} from '../dto/sales-delivery.dto';

const QUANTITY_SCALE = 2;
const NUMBER_ATTEMPTS = 5;
const IDEMPOTENCY_CONSTRAINT = 'idempotency';
const NUMBER_CONSTRAINT = 'tenant_number';

const ORDER_NOT_FOUND = (id: number) => `سفارش با شناسه ${id} یافت نشد.`;
const ORDER_NOT_CONFIRMED = 'فقط سفارش‌های تأییدشده قابل تحویل هستند.';
const LINE_NOT_IN_ORDER = (id: number) => `سطر ${id} در این سفارش وجود ندارد.`;
const DUPLICATE_LINE = 'یک سطر سفارش بیش از یک بار در درخواست آمده است.';
const INVALID_QUANTITY = 'مقدار تحویل نامعتبر است (حداکثر دو رقم اعشار و بزرگ‌تر از صفر).';
const OVER_DELIVERY = (lineNo: number, requested: string, open: string) =>
  `مقدار درخواستی سطر ${lineNo} (${requested}) بیش از مقدار باز آن (${open}) است.`;
const SKU_NOT_FOUND = (itemId: number) => `کالای با شناسه ${itemId} یافت نشد.`;
const DELIVERY_NOT_FOUND = 'حواله تحویل یافت نشد.';
const NUMBER_CONFLICT = 'امکان تولید شماره حواله وجود ندارد؛ دوباره تلاش کنید.';

/** Pg unique violation (23505) whose constraint name contains `part`. */
function isUniqueViolationOn(error: unknown, part: string): boolean {
  const e = error as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  const code = e?.code ?? e?.driverError?.code;
  const constraint = (e?.constraint ?? e?.driverError?.constraint ?? '').toLowerCase();
  return code === '23505' && constraint.includes(part);
}

interface PlannedLine {
  lineNo: number;
  orderLine: SalesOrderLineEntity;
  sku: string;
  requested: bigint;
}

interface IssuedLine extends PlannedLine {
  lineCost: bigint;
}

@Injectable()
export class SalesDeliveryService {
  constructor(
    private readonly salesRepo: SalesRepository,
    private readonly deliveries: SalesDeliveryRepository,
    private readonly inventory: InventoryService,
    private readonly stockDocuments: StockDocumentsService,
    private readonly stockDocsRepo: StockDocumentsRepository,
    private readonly posting: PostingRulesService,
  ) {}

  /**
   * Partial delivery of a confirmed order, all in one tenant transaction: lock the order, check
   * every requested line against its open quantity, issue FIFO stock once per line, write the
   * delivery, the SALES_DELIVERY stock document and the COGS voucher, then bump the order lines.
   * A unique violation on the idempotency key (a concurrent twin request) returns the stored
   * delivery; a number clash retries with the next count.
   */
  async createDelivery(
    tenantId: string,
    orderId: number,
    dto: CreateSalesDeliveryDto,
    userId?: string,
  ): Promise<SalesDeliveryResponseDto> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.salesRepo.runInTransaction(tenantId, (manager) =>
          this.deliverInTransaction(tenantId, orderId, dto, userId ?? null, attempt, manager),
        );
      } catch (error) {
        if (dto.idempotencyKey && isUniqueViolationOn(error, IDEMPOTENCY_CONSTRAINT)) {
          const existing = await this.deliveries.runInTransaction(tenantId, async (manager) => {
            const row = await this.deliveries.findByIdempotencyKey(tenantId, manager, dto.idempotencyKey!);
            return row ? this.responseOf(tenantId, manager, row.id) : null;
          });
          if (existing) return existing;
        }
        if (isUniqueViolationOn(error, NUMBER_CONSTRAINT) && attempt < NUMBER_ATTEMPTS) continue;
        if (isUniqueViolationOn(error, NUMBER_CONSTRAINT)) throw new ConflictException(NUMBER_CONFLICT);
        throw error;
      }
    }
  }

  private async deliverInTransaction(
    tenantId: string,
    orderId: number,
    dto: CreateSalesDeliveryDto,
    userId: string | null,
    attempt: number,
    manager: EntityManager,
  ): Promise<SalesDeliveryResponseDto> {
    const locked = await this.deliveries.lockOrder(tenantId, manager, orderId);
    if (!locked) throw new NotFoundException(ORDER_NOT_FOUND(orderId));
    const { order, lines: orderLines } = locked;

    if (dto.idempotencyKey) {
      const existing = await this.deliveries.findByIdempotencyKey(tenantId, manager, dto.idempotencyKey);
      if (existing) return this.responseOf(tenantId, manager, existing.id);
    }
    if (order.status !== SalesOrderStatus.CONFIRMED) throw new ConflictException(ORDER_NOT_CONFIRMED);

    const plan = await this.planLines(tenantId, manager, dto.lines, orderLines);
    const deliveryNumber = await this.nextNumber(tenantId, manager, attempt);

    const issued: IssuedLine[] = [];
    for (const line of plan) {
      const result = await this.issueLine(tenantId, order, line, deliveryNumber, manager);
      issued.push({ ...line, lineCost: toMinor(result) });
    }
    const totalCost = issued.reduce((sum, line) => sum + line.lineCost, 0n);

    const delivery = await this.deliveries.insertDelivery(tenantId, manager, {
      number: deliveryNumber,
      orderId: order.id,
      partyCode: order.partyCode,
      warehouseId: order.warehouseId,
      deliveryDate: dto.deliveryDate,
      status: 'POSTED',
      idempotencyKey: dto.idempotencyKey ?? null,
      stockDocumentId: null,
      journalEntryId: null,
      totalCost: minorToDecimal(totalCost),
      createdBy: userId,
    });

    const newLines: NewDeliveryLine[] = issued.map((line) => ({
      lineNo: line.lineNo,
      orderLineId: line.orderLine.id,
      itemId: line.orderLine.itemId,
      sku: line.sku,
      quantity: scaledText(line.requested),
      lineCost: minorToDecimal(line.lineCost),
    }));
    const lineRows = await this.deliveries.insertLines(tenantId, manager, delivery.id, newLines);

    const stockDocument = await this.stockDocsRepo.insertDocument(
      tenantId,
      {
        docType: StockDocumentType.SALES_DELIVERY,
        docNumber: `SD-${deliveryNumber}`.slice(0, 40),
        status: StockDocumentStatus.POSTED,
        docDate: dto.deliveryDate,
        fromWarehouseId: order.warehouseId,
        reference: deliveryNumber,
        note: dto.note ?? null,
        createdBy: userId,
        postedAt: new Date(),
      },
      issued.map((line) => ({
        itemId: line.orderLine.itemId,
        sku: line.sku,
        quantity: Number(scaledText(line.requested)),
        unitCost: Number(minorToDecimal(unitCostMinor(line.lineCost, line.requested))),
        value: Number(minorToDecimal(line.lineCost)),
        batchNumber: null,
      })),
      manager,
    );

    let journalEntryId: number | null = null;
    if (totalCost > 0n) {
      const [inventoryCode, cogsCode] = await this.stockDocuments.resolveAccounts(tenantId, [
        STOCK_INVENTORY_ACCOUNT,
        COGS_ACCOUNT,
      ]);
      const posted = await this.posting.post(
        tenantId,
        {
          docType: COGS_DOC_TYPE,
          sourceType: COGS_SOURCE_TYPE,
          sourceId: String(delivery.id),
          date: dto.deliveryDate,
          amounts: { cost: totalCost },
          description: `بهای تمام‌شده حواله ${deliveryNumber}`,
          entryNumber: `${COGS_ENTRY_PREFIX}-${deliveryNumber}`.slice(0, 64),
          overrides: { inventory: inventoryCode, cogs: cogsCode },
        },
        manager,
      );
      journalEntryId = posted.entryId;
    }

    await this.deliveries.setPostingLinks(tenantId, manager, delivery.id, {
      stockDocumentId: stockDocument.id,
      journalEntryId,
    });
    for (const line of issued) {
      await this.deliveries.addDelivered(tenantId, manager, line.orderLine.id, scaledText(line.requested));
    }

    delivery.stockDocumentId = stockDocument.id;
    delivery.journalEntryId = journalEntryId;
    return this.toResponse(delivery, lineRows);
  }

  /** Validates every requested line before any stock moves, so a refusal changes nothing. */
  private async planLines(
    tenantId: string,
    manager: EntityManager,
    requestLines: DeliveryLineDto[],
    orderLines: SalesOrderLineEntity[],
  ): Promise<PlannedLine[]> {
    if (new Set(requestLines.map((line) => line.orderLineId)).size !== requestLines.length) {
      throw new BadRequestException(DUPLICATE_LINE);
    }
    const byId = new Map(orderLines.map((line) => [line.id, line]));
    const picked = requestLines.map((line) => {
      const orderLine = byId.get(line.orderLineId);
      if (!orderLine) throw new BadRequestException(LINE_NOT_IN_ORDER(line.orderLineId));
      return { orderLine, requested: requestedHundredths(line.quantity) };
    });
    const skus = await this.deliveries.skusForItems(
      tenantId,
      manager,
      [...new Set(picked.map((p) => p.orderLine.itemId))],
    );
    return picked.map((p, index) => {
      const ordered = parseScaled(p.orderLine.quantity, QUANTITY_SCALE);
      const delivered = parseScaled(p.orderLine.deliveredQuantity, QUANTITY_SCALE);
      const open = ordered - delivered;
      const lineNo = index + 1;
      if (p.requested > open) {
        throw new ConflictException(OVER_DELIVERY(lineNo, scaledText(p.requested), scaledText(open)));
      }
      const sku = skus.get(p.orderLine.itemId);
      if (!sku) throw new ConflictException(SKU_NOT_FOUND(p.orderLine.itemId));
      return { lineNo, orderLine: p.orderLine, sku, requested: p.requested };
    });
  }

  /** Issues one line through the inventory service (FIFO) and returns its cost in rials. */
  private async issueLine(
    tenantId: string,
    order: SalesOrderEntity,
    line: PlannedLine,
    reference: string,
    manager: EntityManager,
  ): Promise<number> {
    try {
      const result = await this.inventory.issueStock(
        tenantId,
        {
          sku: line.sku,
          quantity: Number(scaledText(line.requested)),
          warehouseId: order.warehouseId,
          reference,
        },
        manager,
      );
      return result.totalCost;
    } catch (error) {
      // Insufficient stock arrives from the inventory service as a 400; a delivery refusal is a 409.
      if (error instanceof BadRequestException) throw new ConflictException(error.message);
      throw error;
    }
  }

  private async nextNumber(tenantId: string, manager: EntityManager, attempt: number): Promise<string> {
    const count = await this.deliveries.countDeliveries(tenantId, manager);
    return `${DELIVERY_NUMBER_PREFIX}-${count + attempt}`;
  }

  async listDeliveries(tenantId: string, query: QuerySalesDeliveryDto): Promise<SalesDeliveryListResponseDto> {
    return this.deliveries.runInTransaction(tenantId, async (manager) => {
      const { rows, total } = await this.deliveries.listDeliveries(tenantId, manager, query);
      const lines = await this.deliveries.linesOf(tenantId, manager, rows.map((row) => row.id));
      return {
        data: rows.map((row) =>
          this.toResponse(row, lines.filter((line) => line.deliveryId === row.id)),
        ),
        total,
      };
    });
  }

  async getDelivery(tenantId: string, id: number): Promise<SalesDeliveryResponseDto> {
    return this.deliveries.runInTransaction(tenantId, (manager) => this.responseOf(tenantId, manager, id));
  }

  async getFulfilment(tenantId: string, orderId: number): Promise<OrderFulfilmentResponseDto> {
    return this.deliveries.runInTransaction(tenantId, async (manager) => {
      const found = await this.deliveries.findOrderWithLines(tenantId, manager, orderId);
      if (!found) throw new NotFoundException(ORDER_NOT_FOUND(orderId));
      const lines = found.lines.map((line) => {
        const ordered = parseScaled(line.quantity, QUANTITY_SCALE);
        const delivered = parseScaled(line.deliveredQuantity, QUANTITY_SCALE);
        return {
          orderLineId: line.id,
          itemId: line.itemId,
          ordered: hundredthsToNumber(ordered),
          delivered: hundredthsToNumber(delivered),
          backorder: hundredthsToNumber(ordered - delivered),
          status: fulfilmentStatus(delivered, ordered),
        };
      });
      return {
        orderId,
        status: overallFulfilmentStatus(lines.map((line) => line.status)),
        lines,
      };
    });
  }

  async listBackorders(tenantId: string, query: QueryBackordersDto): Promise<BackorderListResponseDto> {
    return this.deliveries.runInTransaction(tenantId, async (manager) => {
      const rows = await this.deliveries.openConfirmedLines(tenantId, manager, query.partyCode ?? null);
      const data = rows.flatMap((row) => {
        const backorder = parseScaled(row.quantity, QUANTITY_SCALE) - parseScaled(row.delivered_quantity, QUANTITY_SCALE);
        if (backorder <= 0n) return [];
        return [
          {
            orderId: Number(row.order_id),
            orderNumber: row.order_number,
            partyCode: row.party_code,
            itemId: Number(row.item_id),
            backorder: hundredthsToNumber(backorder),
          },
        ];
      });
      return { data, total: data.length };
    });
  }

  private async responseOf(
    tenantId: string,
    manager: EntityManager,
    id: number,
  ): Promise<SalesDeliveryResponseDto> {
    const delivery = await this.deliveries.findDelivery(tenantId, manager, id);
    if (!delivery) throw new NotFoundException(DELIVERY_NOT_FOUND);
    const lines = await this.deliveries.linesOf(tenantId, manager, [id]);
    return this.toResponse(delivery, lines);
  }

  private toResponse(delivery: SalesDeliveryEntity, lines: SalesDeliveryLineEntity[]): SalesDeliveryResponseDto {
    return {
      id: delivery.id,
      number: delivery.number,
      orderId: delivery.orderId,
      partyCode: delivery.partyCode,
      warehouseId: delivery.warehouseId,
      deliveryDate: delivery.deliveryDate,
      status: delivery.status,
      totalCost: fromMinor(parseScaled(delivery.totalCost, 2)),
      stockDocumentId: delivery.stockDocumentId ?? null,
      journalEntryId: delivery.journalEntryId ?? null,
      createdBy: delivery.createdBy ?? null,
      createdAt: delivery.createdAt,
      lines: lines.map((line) => {
        const lineCost = parseScaled(line.lineCost, 2);
        const quantity = parseScaled(line.quantity, QUANTITY_SCALE);
        return {
          id: line.id,
          lineNo: line.lineNo,
          orderLineId: line.orderLineId,
          itemId: line.itemId,
          sku: line.sku,
          quantity: hundredthsToNumber(quantity),
          lineCost: fromMinor(lineCost),
          unitCost: fromMinor(unitCostMinor(lineCost, quantity)),
        };
      }),
    };
  }
}

/** Request quantity (number or numeric text, at most two decimals) as hundredths. */
function requestedHundredths(value: number | string): bigint {
  try {
    const hundredths = parseQuantityHundredths(value);
    if (hundredths <= 0n) throw new Error('non-positive');
    return hundredths;
  } catch {
    throw new BadRequestException(INVALID_QUANTITY);
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
