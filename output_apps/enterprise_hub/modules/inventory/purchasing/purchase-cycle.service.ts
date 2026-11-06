import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { minorToDecimal } from '../../accounting/money';
import { CreateJournalEntryDto, JournalEntryLineDto } from '../../accounting/dto/create-journal-entry.dto';
import { AccountingService } from '../../accounting/services/accounting.service';
import { TenantScope } from '../../access/services/tenant-scope';
import { InventoryService } from '../services/inventory.service';
import { StockDocumentsService } from '../services/stock-documents.service';
import {
  assertTransition,
  planReceipt,
  PurchaseDomainError,
  ReceiptPlan,
  validateOrderLines,
} from './purchase-order.domain';
import {
  PurchaseAccountRole,
  purchasePostingLines,
  resolvePurchaseRole,
} from './purchase-posting.adapter';
import {
  ConvertPurchaseRequestDto,
  CreateGoodsReceiptDto,
  CreatePurchaseOrderDto,
  CreatePurchaseRequestDto,
  GoodsReceiptResponseDto,
  PurchaseOrderResponseDto,
  PurchaseRequestResponseDto,
  PurchaseSettingsResponseDto,
  UpdatePurchaseSettingsDto,
} from './purchase.dto';
import {
  NewGoodsReceiptLine,
  PurchaseRepository,
} from './purchase.repository';
import {
  GoodsReceipt,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseRequest,
  PurchaseRequestStatus,
  PurchaseSettings,
} from './purchase.types';

const NOT_FOUND_REQUEST = 'درخواست خرید یافت نشد.';
const NOT_FOUND_ORDER = 'سفارش خرید یافت نشد.';
const NOT_FOUND_RECEIPT = 'رسید کالا یافت نشد.';

function toRequestResponse(request: PurchaseRequest): PurchaseRequestResponseDto {
  return {
    id: request.id,
    tenantId: request.tenantId,
    number: request.number,
    status: request.status,
    requestedBy: request.requestedBy,
    lines: request.lines.map((line) => ({ sku: line.sku, quantity: line.quantity.toString() })),
    orderId: request.orderId,
    createdAt: request.createdAt,
  };
}

function toOrderResponse(order: PurchaseOrder): PurchaseOrderResponseDto {
  return {
    id: order.id,
    tenantId: order.tenantId,
    number: order.number,
    supplierCode: order.supplierCode,
    status: order.status,
    warehouseId: order.warehouseId,
    lines: order.lines.map((line) => ({
      id: line.id,
      sku: line.sku,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toString(),
      receivedQuantity: line.receivedQuantity.toString(),
    })),
    requestId: order.requestId,
    orderDate: order.orderDate,
    approvedBy: order.approvedBy,
    approvedAt: order.approvedAt,
    createdAt: order.createdAt,
  };
}

function toReceiptResponse(receipt: GoodsReceipt): GoodsReceiptResponseDto {
  return {
    id: receipt.id,
    tenantId: receipt.tenantId,
    number: receipt.number,
    orderId: receipt.orderId,
    supplierCode: receipt.supplierCode,
    receivedAt: receipt.receivedAt,
    receivedBy: receipt.receivedBy,
    idempotencyKey: receipt.idempotencyKey,
    lines: receipt.lines.map((line) => ({
      id: line.id,
      orderLineId: line.orderLineId,
      sku: line.sku,
      quantity: line.quantity.toString(),
      unitCost: line.unitCost.toString(),
      value: line.value.toString(),
      weight: line.weight === null ? null : line.weight.toString(),
      fifoBatchId: line.fifoBatchId,
    })),
    totalValue: receipt.totalValue.toString(),
    journalEntryId: receipt.journalEntryId,
  };
}

function toSettingsResponse(settings: PurchaseSettings): PurchaseSettingsResponseDto {
  return {
    overReceiptToleranceBp: settings.overReceiptToleranceBp,
    priceToleranceBp: settings.priceToleranceBp ?? 0,
    priceToleranceAbs: (settings.priceToleranceAbs ?? 0n).toString(),
  };
}

/**
 * Purchase request, order and goods receipt (#227 T2). The pure rules live in
 * `purchase-order.domain.ts` and the journal shape in `purchase-posting.adapter.ts`; this service
 * only loads, validates, persists and translates domain errors to HTTP errors.
 */
@Injectable()
export class PurchaseCycleService {
  constructor(
    private readonly scope: TenantScope,
    private readonly repository: PurchaseRepository,
    private readonly inventory: InventoryService,
    private readonly stockDocuments: StockDocumentsService,
    private readonly accounting: AccountingService,
  ) {}

  /** Domain errors become 400 for a bad line/unknown line, 409 for every other rule refusal. */
  private rethrow(error: unknown): never {
    if (error instanceof PurchaseDomainError) {
      if (error.code === 'INVALID_LINE' || error.code === 'UNKNOWN_ORDER_LINE') {
        throw new BadRequestException(error.message);
      }
      throw new ConflictException(error.message);
    }
    throw error;
  }

  private planOrThrow(
    order: PurchaseOrder,
    lines: Array<{ orderLineId: string; quantity: bigint; weight: bigint | null }>,
    settings: PurchaseSettings,
  ): ReceiptPlan {
    try {
      return planReceipt(order, lines, settings);
    } catch (error) {
      this.rethrow(error);
    }
  }

  private transitionOrThrow(from: PurchaseOrderStatus, to: PurchaseOrderStatus): void {
    try {
      assertTransition(from, to);
    } catch (error) {
      this.rethrow(error);
    }
  }

  // ---------------------------------------------------------------- requests

  async createRequest(
    tenantId: string,
    userId: string,
    dto: CreatePurchaseRequestDto,
  ): Promise<PurchaseRequestResponseDto> {
    const seen = new Set<string>();
    const lines = dto.lines.map((line) => {
      const sku = line.sku.trim();
      const quantity = BigInt(line.quantity);
      if (!sku || quantity <= 0n) {
        throw new BadRequestException('هر سطر درخواست به کد کالا و مقدار مثبت نیاز دارد.');
      }
      if (seen.has(sku)) {
        throw new ConflictException(`کد کالای «${sku}» در درخواست تکرار شده است.`);
      }
      seen.add(sku);
      return { sku, quantity };
    });
    return this.repository.run(tenantId, async (manager) => {
      const number = await this.repository.nextNumber(tenantId, 'PR', manager);
      const request = await this.repository.insertRequest(
        tenantId,
        { number, status: PurchaseRequestStatus.OPEN, requestedBy: userId, lines },
        manager,
      );
      return toRequestResponse(request);
    });
  }

  async cancelRequest(
    tenantId: string,
    userId: string,
    requestId: string,
  ): Promise<PurchaseRequestResponseDto> {
    return this.repository.run(tenantId, async (manager) => {
      const request = await this.repository.findRequest(tenantId, requestId, manager, true);
      if (!request) throw new NotFoundException(NOT_FOUND_REQUEST);
      if (request.status !== PurchaseRequestStatus.OPEN) {
        throw new ConflictException('فقط درخواست باز قابل لغو است.');
      }
      await this.repository.updateRequestStatus(tenantId, request.id, PurchaseRequestStatus.CANCELLED, manager);
      return toRequestResponse({ ...request, status: PurchaseRequestStatus.CANCELLED });
    });
  }

  async listRequests(tenantId: string): Promise<PurchaseRequestResponseDto[]> {
    return this.repository.run(tenantId, async (manager) => {
      const requests = await this.repository.listRequests(tenantId, manager);
      return requests.map(toRequestResponse);
    });
  }

  async convertRequest(
    tenantId: string,
    userId: string,
    requestId: string,
    dto: ConvertPurchaseRequestDto,
  ): Promise<PurchaseOrderResponseDto> {
    return this.repository.run(tenantId, async (manager) => {
      const request = await this.repository.findRequest(tenantId, requestId, manager, true);
      if (!request) throw new NotFoundException(NOT_FOUND_REQUEST);
      if (request.status !== PurchaseRequestStatus.OPEN) {
        throw new ConflictException('درخواست خرید قبلاً تبدیل یا لغو شده است.');
      }
      const lines = request.lines.map((line) => {
        const raw = dto.prices[line.sku];
        if (raw === undefined || !/^\d+$/.test(raw)) {
          throw new BadRequestException(`قیمت کالای «${line.sku}» ارسال نشده است.`);
        }
        return { sku: line.sku, quantity: line.quantity, unitPrice: BigInt(raw) };
      });
      try {
        validateOrderLines(lines);
      } catch (error) {
        this.rethrow(error);
      }
      const number = await this.repository.nextNumber(tenantId, 'PO', manager);
      const order = await this.repository.insertOrder(
        tenantId,
        {
          number,
          supplierCode: dto.supplierCode.trim(),
          status: PurchaseOrderStatus.DRAFT,
          warehouseId: dto.warehouseId ?? null,
          requestId: request.id,
          orderDate: dto.orderDate,
          lines,
        },
        manager,
      );
      await this.repository.updateRequestStatus(
        tenantId,
        request.id,
        PurchaseRequestStatus.ORDERED,
        manager,
        order.id,
      );
      return toOrderResponse(order);
    });
  }

  // ------------------------------------------------------------------ orders

  async createOrder(
    tenantId: string,
    userId: string,
    dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderResponseDto> {
    const lines = dto.lines.map((line) => ({
      sku: line.sku.trim(),
      quantity: BigInt(line.quantity),
      unitPrice: BigInt(line.unitPrice),
    }));
    try {
      validateOrderLines(lines);
    } catch (error) {
      this.rethrow(error);
    }
    return this.repository.run(tenantId, async (manager) => {
      const number = await this.repository.nextNumber(tenantId, 'PO', manager);
      const order = await this.repository.insertOrder(
        tenantId,
        {
          number,
          supplierCode: dto.supplierCode.trim(),
          status: PurchaseOrderStatus.DRAFT,
          warehouseId: dto.warehouseId ?? null,
          requestId: null,
          orderDate: dto.orderDate,
          lines,
        },
        manager,
      );
      return toOrderResponse(order);
    });
  }

  async approveOrder(
    tenantId: string,
    userId: string,
    orderId: string,
  ): Promise<PurchaseOrderResponseDto> {
    return this.repository.run(tenantId, async (manager) => {
      const order = await this.repository.findOrder(tenantId, orderId, manager, true);
      if (!order) throw new NotFoundException(NOT_FOUND_ORDER);
      this.transitionOrThrow(order.status, PurchaseOrderStatus.APPROVED);
      const approvedAt = new Date();
      await this.repository.updateOrderStatus(
        tenantId,
        order.id,
        PurchaseOrderStatus.APPROVED,
        manager,
        { approvedBy: userId, approvedAt },
      );
      return toOrderResponse({
        ...order,
        status: PurchaseOrderStatus.APPROVED,
        approvedBy: userId,
        approvedAt,
      });
    });
  }

  async cancelOrder(
    tenantId: string,
    userId: string,
    orderId: string,
  ): Promise<PurchaseOrderResponseDto> {
    return this.repository.run(tenantId, async (manager) => {
      const order = await this.repository.findOrder(tenantId, orderId, manager, true);
      if (!order) throw new NotFoundException(NOT_FOUND_ORDER);
      this.transitionOrThrow(order.status, PurchaseOrderStatus.CANCELLED);
      await this.repository.updateOrderStatus(tenantId, order.id, PurchaseOrderStatus.CANCELLED, manager);
      return toOrderResponse({ ...order, status: PurchaseOrderStatus.CANCELLED });
    });
  }

  async closeOrder(
    tenantId: string,
    userId: string,
    orderId: string,
  ): Promise<PurchaseOrderResponseDto> {
    return this.repository.run(tenantId, async (manager) => {
      const order = await this.repository.findOrder(tenantId, orderId, manager, true);
      if (!order) throw new NotFoundException(NOT_FOUND_ORDER);
      this.transitionOrThrow(order.status, PurchaseOrderStatus.CLOSED);
      await this.repository.updateOrderStatus(tenantId, order.id, PurchaseOrderStatus.CLOSED, manager);
      return toOrderResponse({ ...order, status: PurchaseOrderStatus.CLOSED });
    });
  }

  async getOrder(tenantId: string, orderId: string): Promise<PurchaseOrderResponseDto> {
    return this.repository.run(tenantId, async (manager) => {
      const order = await this.repository.findOrder(tenantId, orderId, manager);
      if (!order) throw new NotFoundException(NOT_FOUND_ORDER);
      return toOrderResponse(order);
    });
  }

  async listOrders(
    tenantId: string,
    status?: PurchaseOrderStatus,
  ): Promise<PurchaseOrderResponseDto[]> {
    return this.repository.run(tenantId, async (manager) => {
      const orders = await this.repository.listOrders(tenantId, status, manager);
      return orders.map(toOrderResponse);
    });
  }

  // ---------------------------------------------------------------- receipts

  async createReceipt(
    tenantId: string,
    userId: string,
    orderId: string,
    dto: CreateGoodsReceiptDto,
  ): Promise<GoodsReceiptResponseDto> {
    return this.scope.run(tenantId, async (manager) => {
      const idempotencyKey = dto.idempotencyKey ?? null;
      if (idempotencyKey) {
        const existing = await this.repository.findReceiptByKey(tenantId, idempotencyKey, manager);
        if (existing) return toReceiptResponse(existing);
      }

      const order = await this.repository.findOrder(tenantId, orderId, manager, true);
      if (!order) throw new NotFoundException(NOT_FOUND_ORDER);
      const settings = await this.repository.getSettings(tenantId, manager);
      const plan = this.planOrThrow(
        order,
        dto.lines.map((line) => ({
          orderLineId: line.orderLineId,
          quantity: BigInt(line.quantity),
          weight: line.weight === undefined ? null : BigInt(line.weight),
        })),
        settings,
      );

      const number = await this.repository.nextNumber(tenantId, 'GR', manager);
      const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
      const receiptLines: NewGoodsReceiptLine[] = [];
      for (const line of plan.lines) {
        const result = await this.inventory.receiveStock(
          tenantId,
          {
            sku: line.sku,
            quantity: Number(line.quantity) / 100,
            unitPurchaseCost: Number(line.unitCost) / 100,
            warehouseId: order.warehouseId ?? undefined,
            receivedAt: receivedAt.toISOString(),
            reference: number,
          },
          manager,
        );
        receiptLines.push({ ...line, fifoBatchId: result.layers[0]?.batchId ?? null });
      }

      const receipt = await this.repository.insertReceipt(
        tenantId,
        {
          number,
          orderId: order.id,
          supplierCode: order.supplierCode,
          receivedAt,
          receivedBy: userId,
          idempotencyKey,
          totalValue: plan.totalValue,
          journalEntryId: null,
        },
        receiptLines,
        manager,
      );

      await this.repository.updateOrderLines(tenantId, order.id, plan.receivedAfter, manager);
      await this.repository.updateOrderStatus(tenantId, order.id, plan.statusAfter, manager);

      const journalEntryId = await this.postReceipt(tenantId, order, receipt, receivedAt, manager);
      if (journalEntryId) {
        await this.repository.updateReceiptJournalEntry(tenantId, receipt.id, journalEntryId, manager);
        receipt.journalEntryId = journalEntryId;
      }
      return toReceiptResponse(receipt);
    });
  }

  async getReceipt(tenantId: string, receiptId: string): Promise<GoodsReceiptResponseDto> {
    return this.repository.run(tenantId, async (manager) => {
      const receipt = await this.repository.findReceipt(tenantId, receiptId, manager);
      if (!receipt) throw new NotFoundException(NOT_FOUND_RECEIPT);
      return toReceiptResponse(receipt);
    });
  }

  async listReceipts(tenantId: string, orderId?: string): Promise<GoodsReceiptResponseDto[]> {
    return this.repository.run(tenantId, async (manager) => {
      const receipts = await this.repository.listReceipts(tenantId, orderId, manager);
      return receipts.map(toReceiptResponse);
    });
  }

  /** Posts INVENTORY debit / GRNI credit at PO price; returns the journal entry id, or null at zero value. */
  private async postReceipt(
    tenantId: string,
    order: PurchaseOrder,
    receipt: GoodsReceipt,
    receivedAt: Date,
    manager: EntityManager,
  ): Promise<string | null> {
    const posting = purchasePostingLines({
      kind: 'GOODS_RECEIPT',
      receiptId: receipt.id,
      receiptNumber: receipt.number,
      orderNumber: order.number,
      supplierCode: order.supplierCode,
      receivedAt,
      value: receipt.totalValue,
    });
    if (!posting) return null;

    const [inventoryCode, grniCode] = await this.stockDocuments.resolveAccounts(tenantId, [
      resolvePurchaseRole(PurchaseAccountRole.INVENTORY),
      resolvePurchaseRole(PurchaseAccountRole.GRNI),
    ]);

    const lines: JournalEntryLineDto[] = posting.lines.map((line) => {
      const entryLine: JournalEntryLineDto = {
        accountCode: line.role === PurchaseAccountRole.INVENTORY ? inventoryCode : grniCode,
        description: line.description,
      };
      if (line.debit > 0n) entryLine.debit = minorToDecimal(line.debit);
      if (line.credit > 0n) entryLine.credit = minorToDecimal(line.credit);
      if (line.partyCode) entryLine.partyCode = line.partyCode;
      return entryLine;
    });

    const dto: CreateJournalEntryDto = {
      entryNumber: `GRN-${receipt.number}`,
      date: receivedAt.toISOString(),
      description: posting.description,
      lines,
    };
    const entry = await this.accounting.createJournalEntry(tenantId, dto, manager);
    return String(entry.id);
  }

  // ---------------------------------------------------------------- settings

  async getSettings(tenantId: string): Promise<PurchaseSettingsResponseDto> {
    return this.repository.run(tenantId, async (manager) => {
      return toSettingsResponse(await this.repository.getSettings(tenantId, manager));
    });
  }

  async updateSettings(
    tenantId: string,
    dto: UpdatePurchaseSettingsDto,
  ): Promise<PurchaseSettingsResponseDto> {
    return this.repository.run(tenantId, async (manager) => {
      const current = await this.repository.getSettings(tenantId, manager);
      const saved = await this.repository.upsertSettings(
        tenantId,
        {
          overReceiptToleranceBp: dto.overReceiptToleranceBp ?? current.overReceiptToleranceBp,
          priceToleranceBp: dto.priceToleranceBp ?? current.priceToleranceBp ?? 0,
          priceToleranceAbs:
            dto.priceToleranceAbs === undefined
              ? current.priceToleranceAbs ?? 0n
              : BigInt(dto.priceToleranceAbs),
        },
        manager,
      );
      return toSettingsResponse(saved);
    });
  }
}