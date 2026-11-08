import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { fromDb, fromMinor, minorToDecimal, scaledToDecimal, toMinor } from '../../accounting/money';
import { PartyRole } from '../../parties/enums/party-role.enum';
import { PartiesService } from '../../parties/services/parties.service';
import { CreditExposureService } from '../policy/credit-exposure.service';
import { DiscountPolicyService } from '../policy/discount-policy.service';
import {
  ChangeSalesQuotationStatusDto,
  ConvertQuotationDto,
  CreateSalesOrderDto,
  CreateSalesQuotationDto,
  QuerySalesOrderDto,
  QuerySalesQuotationDto,
  SalesLineResponseDto,
  SalesLineDto,
  SalesOrderLineResponseDto,
  SalesOrderListResponseDto,
  SalesOrderResponseDto,
  SalesQuotationListResponseDto,
  SalesQuotationResponseDto,
  UpdateSalesOrderDto,
  UpdateSalesQuotationDto,
} from '../dto/sales.dto';
import { SalesOrderLineEntity, SalesOrderEntity } from '../entities/sales-order.entity';
import { SalesQuotationLineEntity, SalesQuotationEntity } from '../entities/sales-quotation.entity';
import {
  QUOTATION_CONVERTIBLE,
  QUOTATION_TRANSITIONS,
  SALES_ORDER_PREFIX,
  SALES_QUOTATION_PREFIX,
  SalesOrderStatus,
  SalesQuotationStatus,
} from '../enums/sales-status.enum';
import { computeLine, parseQuantityHundredths, QUANTITY_SCALE, SalesMathError, sumLineTotals } from '../sales-math';
import { OrderHeaderInput, QuotationHeaderInput, SalesLineInput, SalesRepository } from '../repositories/sales.repository';

const QUOTATION_NOT_FOUND = 'پیش‌فاکتور یافت نشد.';
const ORDER_NOT_FOUND = 'سفارش فروش یافت نشد.';
const WRONG_STATE = 'تغییر وضعیت در این حالت مجاز نیست.';
const CONVERT_STATE = 'فقط پیش‌فاکتور ارسال‌شده یا پذیرفته‌شده قابل تبدیل است.';
const PARTY_INVALID = 'طرف حساب باید مشتری و فعال باشد.';
const ITEM_MISSING = 'یکی از کالاهای انتخابی یافت نشد.';
const WAREHOUSE_MISSING = 'انبار یافت نشد.';
const CANCEL_DELIVERED = 'سفارش دارای تحویل، قابل لغو نیست.';
const NUMBER_ATTEMPTS = 5;

interface BuiltLines {
  lines: SalesLineInput[];
  total: string;
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } };
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

/** Shape shared by a quotation line and an order line, so the response mapper serves both. */
type SalesLineLike = Pick<
  SalesQuotationLineEntity,
  'id' | 'lineNo' | 'itemId' | 'description' | 'quantity' | 'unitPrice' | 'discount' | 'lineTotal'
>;

/** Entity line -> API line; pure so the tests and any consumer can reuse it. */
export function toQuotationLineResponse(line: SalesLineLike): SalesLineResponseDto {
  return {
    id: line.id,
    lineNo: line.lineNo,
    itemId: line.itemId,
    description: line.description ?? null,
    quantity: Number(line.quantity),
    unitPrice: fromMinor(fromDb(line.unitPrice)),
    discount: fromMinor(fromDb(line.discount)),
    lineTotal: fromMinor(fromDb(line.lineTotal)),
  };
}

export function toOrderLineResponse(line: SalesOrderLineEntity): SalesOrderLineResponseDto {
  return {
    ...toQuotationLineResponse(line),
    deliveredQuantity: Number(line.deliveredQuantity),
    invoicedQuantity: Number(line.invoicedQuantity),
  };
}

export function toQuotationResponse(
  quotation: SalesQuotationEntity,
  lines?: SalesQuotationLineEntity[],
): SalesQuotationResponseDto {
  return {
    id: quotation.id,
    number: quotation.number,
    partyCode: quotation.partyCode,
    quoteDate: quotation.quoteDate,
    validUntil: quotation.validUntil ?? null,
    status: quotation.status,
    note: quotation.note ?? null,
    totalAmount: fromMinor(fromDb(quotation.totalAmount)),
    createdBy: quotation.createdBy ?? null,
    createdAt: quotation.createdAt,
    updatedAt: quotation.updatedAt,
    ...(lines ? { lines: lines.map(toQuotationLineResponse) } : {}),
  };
}

export function toOrderResponse(order: SalesOrderEntity, lines?: SalesOrderLineEntity[]): SalesOrderResponseDto {
  return {
    id: order.id,
    number: order.number,
    partyCode: order.partyCode,
    quotationId: order.quotationId ?? null,
    warehouseId: order.warehouseId,
    orderDate: order.orderDate,
    promisedDate: order.promisedDate ?? null,
    status: order.status,
    note: order.note ?? null,
    totalAmount: fromMinor(fromDb(order.totalAmount)),
    createdBy: order.createdBy ?? null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    ...(lines ? { lines: lines.map(toOrderLineResponse) } : {}),
  };
}

/**
 * Quotations and sales orders. The party must be an active customer (or `both`); every item is
 * checked against `erp_stock_items` and the order warehouse against `erp_warehouses`, all inside the
 * scoped transaction. Totals are exact bigint minor units; no VAT is applied here (the invoice
 * posts it from the statutory store). A quotation converts into exactly one order, atomically.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly repository: SalesRepository,
    private readonly parties: PartiesService,
    @Optional() private readonly creditExposure?: CreditExposureService,
    @Optional() private readonly discountPolicy?: DiscountPolicyService,
  ) {}

  // ------------------------------------------------------------------ quotations

  async createQuotation(
    tenantId: string,
    dto: CreateSalesQuotationDto,
    userId?: string,
    roleKey: string = 'owner',
  ): Promise<SalesQuotationResponseDto> {
    await this.assertCustomer(tenantId, dto.partyCode);
    if (this.discountPolicy) {
      const lineDiscounts = dto.lines.map((l) => ({
        discountAmountMinor: l.discount !== undefined ? toMinor(l.discount) : 0n,
        grossAmountMinor: computeLine(parseQuantityHundredths(l.quantity), toMinor(l.unitPrice), 0n),
      }));
      await this.discountPolicy.checkDiscount(tenantId, roleKey, lineDiscounts);
    }
    const id = await this.runNumbered(tenantId, async (manager, attempt) => {
      const built = await this.buildLines(tenantId, manager, dto.lines);
      const count = await this.repository.countQuotations(tenantId, manager);
      const header: QuotationHeaderInput = {
        number: `${SALES_QUOTATION_PREFIX}-${count + attempt}`,
        partyCode: dto.partyCode,
        quoteDate: dto.quoteDate,
        validUntil: dto.validUntil ?? null,
        note: dto.note ?? null,
        totalAmount: built.total,
        createdBy: userId ?? null,
      };
      const created = await this.repository.insertQuotation(tenantId, manager, header, built.lines);
      return created.id;
    });
    return this.getQuotation(tenantId, id);
  }

  async updateQuotation(
    tenantId: string,
    id: number,
    dto: UpdateSalesQuotationDto,
    roleKey: string = 'owner',
  ): Promise<SalesQuotationResponseDto> {
    await this.assertCustomer(tenantId, dto.partyCode);
    if (this.discountPolicy) {
      const lineDiscounts = dto.lines.map((l) => ({
        discountAmountMinor: l.discount !== undefined ? toMinor(l.discount) : 0n,
        grossAmountMinor: computeLine(parseQuantityHundredths(l.quantity), toMinor(l.unitPrice), 0n),
      }));
      await this.discountPolicy.checkDiscount(tenantId, roleKey, lineDiscounts);
    }
    await this.repository.runInTransaction(tenantId, async (manager) => {
      const quotation = await manager.getRepository(SalesQuotationEntity).findOne({ where: { tenantId, id } });
      if (!quotation) throw new NotFoundException(QUOTATION_NOT_FOUND);
      if (quotation.status !== SalesQuotationStatus.DRAFT) throw new ConflictException(WRONG_STATE);
      const built = await this.buildLines(tenantId, manager, dto.lines);
      await this.repository.updateQuotation(tenantId, manager, id, {
        partyCode: dto.partyCode,
        quoteDate: dto.quoteDate,
        validUntil: dto.validUntil ?? null,
        note: dto.note ?? null,
        totalAmount: built.total,
      });
      await this.repository.replaceQuotationLines(tenantId, manager, id, built.lines);
    });
    return this.getQuotation(tenantId, id);
  }

  async changeQuotationStatus(
    tenantId: string,
    id: number,
    dto: ChangeSalesQuotationStatusDto,
  ): Promise<SalesQuotationResponseDto> {
    await this.repository.runInTransaction(tenantId, async (manager) => {
      const quotation = await manager.getRepository(SalesQuotationEntity).findOne({ where: { tenantId, id } });
      if (!quotation) throw new NotFoundException(QUOTATION_NOT_FOUND);
      const allowed = QUOTATION_TRANSITIONS[quotation.status] ?? [];
      if (!allowed.includes(dto.status)) throw new ConflictException(WRONG_STATE);
      await this.repository.updateQuotation(tenantId, manager, id, { status: dto.status });
    });
    return this.getQuotation(tenantId, id);
  }

  async convertQuotation(
    tenantId: string,
    id: number,
    dto: ConvertQuotationDto,
    userId?: string,
  ): Promise<SalesOrderResponseDto> {
    let warning: string | undefined;
    const orderId = await this.runNumbered(tenantId, async (manager, attempt) => {
      const quotation = await manager
        .getRepository(SalesQuotationEntity)
        .findOne({ where: { tenantId, id }, lock: { mode: 'pessimistic_write' } });
      if (!quotation) throw new NotFoundException(QUOTATION_NOT_FOUND);
      if (!QUOTATION_CONVERTIBLE.includes(quotation.status)) throw new ConflictException(CONVERT_STATE);
      if (!(await this.repository.warehouseExists(tenantId, manager, dto.warehouseId))) {
        throw new BadRequestException(WAREHOUSE_MISSING);
      }
      if (this.creditExposure) {
        const quotationTotalMinor = toMinor(quotation.totalAmount);
        const exposureCheck = await this.creditExposure.checkCreditExposure(
          tenantId,
          quotation.partyCode,
          quotationTotalMinor,
          manager,
        );
        if (exposureCheck.warning) warning = exposureCheck.warning;
      }
      const quotationLines = await manager.getRepository(SalesQuotationLineEntity).find({
        where: { tenantId, quotationId: id },
        order: { lineNo: 'ASC' },
      });
      const lines: SalesLineInput[] = quotationLines.map((line) => ({
        lineNo: line.lineNo,
        itemId: line.itemId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        lineTotal: line.lineTotal,
      }));
      const count = await this.repository.countOrders(tenantId, manager);
      const header: OrderHeaderInput = {
        number: `${SALES_ORDER_PREFIX}-${count + attempt}`,
        partyCode: quotation.partyCode,
        quotationId: id,
        warehouseId: dto.warehouseId,
        orderDate: dto.orderDate,
        promisedDate: dto.promisedDate ?? null,
        note: null,
        totalAmount: quotation.totalAmount,
        createdBy: userId ?? null,
      };
      const order = await this.repository.insertOrder(tenantId, manager, header, lines);
      await this.repository.updateQuotation(tenantId, manager, id, { status: SalesQuotationStatus.CONVERTED });
      return order.id;
    });
    const result = await this.getOrder(tenantId, orderId);
    if (warning) result.warning = warning;
    return result;
  }

  async listQuotations(tenantId: string, query: QuerySalesQuotationDto): Promise<SalesQuotationListResponseDto> {
    const { rows, total } = await this.repository.listQuotations(tenantId, {
      partyCode: query.partyCode,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
    return { data: rows.map((row) => toQuotationResponse(row)), total };
  }

  async getQuotation(tenantId: string, id: number): Promise<SalesQuotationResponseDto> {
    const found = await this.repository.findQuotation(tenantId, id);
    if (!found) throw new NotFoundException(QUOTATION_NOT_FOUND);
    return toQuotationResponse(found.quotation, found.lines);
  }

  // ------------------------------------------------------------------ orders

  async createOrder(
    tenantId: string,
    dto: CreateSalesOrderDto,
    userId?: string,
    roleKey: string = 'owner',
  ): Promise<SalesOrderResponseDto> {
    await this.assertCustomer(tenantId, dto.partyCode);
    if (this.discountPolicy) {
      const lineDiscounts = dto.lines.map((l) => ({
        discountAmountMinor: l.discount !== undefined ? toMinor(l.discount) : 0n,
        grossAmountMinor: computeLine(parseQuantityHundredths(l.quantity), toMinor(l.unitPrice), 0n),
      }));
      await this.discountPolicy.checkDiscount(tenantId, roleKey, lineDiscounts);
    }
    let warning: string | undefined;
    const id = await this.runNumbered(tenantId, async (manager, attempt) => {
      if (!(await this.repository.warehouseExists(tenantId, manager, dto.warehouseId))) {
        throw new BadRequestException(WAREHOUSE_MISSING);
      }
      const built = await this.buildLines(tenantId, manager, dto.lines);
      if (this.creditExposure) {
        const orderTotalMinor = sumLineTotals(built.lines.map((l) => toMinor(l.lineTotal)));
        const exposureCheck = await this.creditExposure.checkCreditExposure(
          tenantId,
          dto.partyCode,
          orderTotalMinor,
          manager,
        );
        if (exposureCheck.warning) warning = exposureCheck.warning;
      }
      const count = await this.repository.countOrders(tenantId, manager);
      const header: OrderHeaderInput = {
        number: `${SALES_ORDER_PREFIX}-${count + attempt}`,
        partyCode: dto.partyCode,
        quotationId: null,
        warehouseId: dto.warehouseId,
        orderDate: dto.orderDate,
        promisedDate: dto.promisedDate ?? null,
        note: dto.note ?? null,
        totalAmount: built.total,
        createdBy: userId ?? null,
      };
      const created = await this.repository.insertOrder(tenantId, manager, header, built.lines);
      return created.id;
    });
    const orderRes = await this.getOrder(tenantId, id);
    if (warning) orderRes.warning = warning;
    return orderRes;
  }

  async updateOrder(
    tenantId: string,
    id: number,
    dto: UpdateSalesOrderDto,
    roleKey: string = 'owner',
  ): Promise<SalesOrderResponseDto> {
    await this.assertCustomer(tenantId, dto.partyCode);
    if (this.discountPolicy) {
      const lineDiscounts = dto.lines.map((l) => ({
        discountAmountMinor: l.discount !== undefined ? toMinor(l.discount) : 0n,
        grossAmountMinor: computeLine(parseQuantityHundredths(l.quantity), toMinor(l.unitPrice), 0n),
      }));
      await this.discountPolicy.checkDiscount(tenantId, roleKey, lineDiscounts);
    }
    let warning: string | undefined;
    await this.repository.runInTransaction(tenantId, async (manager) => {
      const order = await manager.getRepository(SalesOrderEntity).findOne({ where: { tenantId, id } });
      if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
      if (order.status !== SalesOrderStatus.DRAFT) throw new ConflictException(WRONG_STATE);
      if (!(await this.repository.warehouseExists(tenantId, manager, dto.warehouseId))) {
        throw new BadRequestException(WAREHOUSE_MISSING);
      }
      const built = await this.buildLines(tenantId, manager, dto.lines);
      if (this.creditExposure) {
        const orderTotalMinor = sumLineTotals(built.lines.map((l) => toMinor(l.lineTotal)));
        const exposureCheck = await this.creditExposure.checkCreditExposure(
          tenantId,
          dto.partyCode,
          orderTotalMinor,
          manager,
        );
        if (exposureCheck.warning) warning = exposureCheck.warning;
      }
      await this.repository.updateOrder(tenantId, manager, id, {
        partyCode: dto.partyCode,
        warehouseId: dto.warehouseId,
        orderDate: dto.orderDate,
        promisedDate: dto.promisedDate ?? null,
        note: dto.note ?? null,
        totalAmount: built.total,
      });
      await this.repository.replaceOrderLines(tenantId, manager, id, built.lines);
    });
    const orderRes = await this.getOrder(tenantId, id);
    if (warning) orderRes.warning = warning;
    return orderRes;
  }

  async confirmOrder(tenantId: string, id: number): Promise<SalesOrderResponseDto> {
    let warning: string | undefined;
    await this.repository.runInTransaction(tenantId, async (manager) => {
      const order = await manager.getRepository(SalesOrderEntity).findOne({ where: { tenantId, id } });
      if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
      if (order.status !== SalesOrderStatus.DRAFT) throw new ConflictException(WRONG_STATE);
      if (this.creditExposure) {
        const orderTotalMinor = toMinor(order.totalAmount);
        const exposureCheck = await this.creditExposure.checkCreditExposure(
          tenantId,
          order.partyCode,
          orderTotalMinor,
          manager,
        );
        if (exposureCheck.warning) warning = exposureCheck.warning;
      }
      await this.repository.updateOrder(tenantId, manager, id, { status: SalesOrderStatus.CONFIRMED });
    });
    const orderRes = await this.getOrder(tenantId, id);
    if (warning) orderRes.warning = warning;
    return orderRes;
  }

  async cancelOrder(tenantId: string, id: number): Promise<SalesOrderResponseDto> {
    await this.repository.runInTransaction(tenantId, async (manager) => {
      const order = await manager.getRepository(SalesOrderEntity).findOne({ where: { tenantId, id } });
      if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
      if (order.status !== SalesOrderStatus.DRAFT && order.status !== SalesOrderStatus.CONFIRMED) {
        throw new ConflictException(WRONG_STATE);
      }
      const lines = await manager.getRepository(SalesOrderLineEntity).find({ where: { tenantId, orderId: id } });
      if (lines.some((line) => Number(line.deliveredQuantity) > 0)) {
        throw new ConflictException(CANCEL_DELIVERED);
      }
      await this.repository.updateOrder(tenantId, manager, id, { status: SalesOrderStatus.CANCELLED });
    });
    return this.getOrder(tenantId, id);
  }

  async listOrders(tenantId: string, query: QuerySalesOrderDto): Promise<SalesOrderListResponseDto> {
    const { rows, total } = await this.repository.listOrders(tenantId, {
      partyCode: query.partyCode,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
    return { data: rows.map((row) => toOrderResponse(row)), total };
  }

  async getOrder(tenantId: string, id: number): Promise<SalesOrderResponseDto> {
    const found = await this.repository.findOrder(tenantId, id);
    if (!found) throw new NotFoundException(ORDER_NOT_FOUND);
    return toOrderResponse(found.order, found.lines);
  }

  // ------------------------------------------------------------------ helpers

  /** The customer check shared by every write: active, and role customer or both. */
  private async assertCustomer(tenantId: string, partyCode: string): Promise<void> {
    const party = await this.parties.getByCode(tenantId, partyCode);
    const sellable = party.role === PartyRole.CUSTOMER || party.role === PartyRole.BOTH;
    if (!party.active || !sellable) throw new BadRequestException(PARTY_INVALID);
  }

  /** Exact line building and item existence check, inside the caller's transaction. */
  private async buildLines(tenantId: string, manager: EntityManager, dtos: SalesLineDto[]): Promise<BuiltLines> {
    const itemIds = [...new Set(dtos.map((dto) => dto.itemId))];
    const existing = await this.repository.existingItemIds(tenantId, manager, itemIds);
    if (itemIds.some((itemId) => !existing.has(itemId))) throw new BadRequestException(ITEM_MISSING);

    const lines: SalesLineInput[] = [];
    const totals: bigint[] = [];
    dtos.forEach((dto, index) => {
      let quantity: bigint;
      let unitPrice: bigint;
      let discount: bigint;
      let lineTotal: bigint;
      try {
        quantity = parseQuantityHundredths(dto.quantity);
        unitPrice = toMinor(dto.unitPrice);
        discount = dto.discount === undefined ? 0n : toMinor(dto.discount);
        lineTotal = computeLine(quantity, unitPrice, discount);
      } catch (error) {
        if (error instanceof SalesMathError) throw new BadRequestException(error.message);
        throw error;
      }
      lines.push({
        lineNo: index + 1,
        itemId: dto.itemId,
        description: dto.description ?? null,
        quantity: scaledToDecimal(quantity, QUANTITY_SCALE),
        unitPrice: minorToDecimal(unitPrice),
        discount: minorToDecimal(discount),
        lineTotal: minorToDecimal(lineTotal),
      });
      totals.push(lineTotal);
    });
    return { lines, total: minorToDecimal(sumLineTotals(totals)) };
  }

  /**
   * Opens one transaction per attempt and hands the callback the prefix; retries the whole
   * transaction when a concurrent document took the auto number (unique on tenant + number).
   */
  private async runNumbered(
    tenantId: string,
    work: (manager: EntityManager, attempt: number) => Promise<number>,
  ): Promise<number> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.repository.runInTransaction(tenantId, (manager) => work(manager, attempt));
      } catch (error) {
        if (isUniqueViolation(error) && attempt < NUMBER_ATTEMPTS) continue;
        throw error;
      }
    }
  }
}
