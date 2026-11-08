import { decideRoleAccount } from '../../accounting/services/role-account-resolver';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { toMinor } from '../../accounting/money';
import { AccountingService } from '../../accounting/services/accounting.service';
import { Currency } from '../../currency/enums/currency.enum';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import {
  OPENING_STOCK_EQUITY_ACCOUNT,
  STOCK_ADJUSTMENT_ACCOUNT,
  STOCK_INVENTORY_ACCOUNT,
  StockAccountSpec,
} from '../constants/stock-accounts';
import { MONEY_SCALE } from '../constants/inventory.constants';
import {
  CreateAdjustmentDto,
  CreateDeliveryDto,
  CreateReceiptDto,
  CreateTransferDto,
  QueryStockDocumentDto,
  StockDocumentResponseDto,
} from '../dto/stock-document.dto';
import { StockDocumentEntity, StockDocumentLineEntity } from '../entities/stock-document.entity';
import {
  STOCK_DOCUMENT_PREFIX,
  StockDocumentStatus,
  StockDocumentType,
} from '../enums/stock-document.enum';
import {
  InsufficientStockError,
  StockItemMissingError,
  WarehouseInactiveError,
  WarehouseMissingError,
} from '../errors/inventory.errors';
import { StockDocumentsRepository } from '../repositories/stock-documents.repository';
import {
  STOCK_SOURCE_TYPE,
  stockPostingDocType,
  stockPostingOverrides,
  StockValueKind,
} from '../posting/stock-posting';
import { InventoryService } from './inventory.service';

type LineInput = Omit<StockDocumentLineEntity, 'id' | 'tenantId' | 'documentId'>;

/** Postgres unique-violation code. */
const UNIQUE_VIOLATION = '23505';
const NUMBER_ATTEMPTS = 4;

/** Stock documents: every stock event is one numbered document with its lines. */
@Injectable()
export class StockDocumentsService {
  constructor(
    private readonly repository: StockDocumentsRepository,
    @Optional() private readonly inventory?: InventoryService,
    @Optional() private readonly accounting?: AccountingService,
    @Optional() private readonly postingRules?: PostingRulesService,
  ) {}

  private money(value: number): number {
    const factor = 10 ** MONEY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Domain errors from the repository become the matching HTTP errors. */
  private rethrow(error: unknown): never {
    if (
      error instanceof StockItemMissingError ||
      error instanceof WarehouseMissingError
    ) {
      throw new NotFoundException(error.message);
    }
    if (error instanceof InsufficientStockError || error instanceof WarehouseInactiveError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (error as { code?: string })?.code === UNIQUE_VIOLATION;
  }

  toResponse(
    document: StockDocumentEntity,
    lines?: StockDocumentLineEntity[],
  ): StockDocumentResponseDto {
    return {
      id: document.id,
      docNumber: document.docNumber,
      docType: document.docType,
      status: document.status,
      docDate: String(document.docDate).slice(0, 10),
      fromWarehouseId: document.fromWarehouseId ?? null,
      toWarehouseId: document.toWarehouseId ?? null,
      reference: document.reference ?? null,
      note: document.note ?? null,
      sourceInvoiceId: document.sourceInvoiceId ?? null,
      journalEntryId: document.journalEntryId ?? null,
      createdBy: document.createdBy ?? null,
      createdAt: document.createdAt,
      totalValue: this.money((lines ?? []).reduce((sum, line) => sum + Number(line.value), 0)),
      ...(lines
        ? {
            lines: lines.map((line) => ({
              id: line.id,
              sku: line.sku,
              quantity: Number(line.quantity),
              unitCost: Number(line.unitCost),
              value: Number(line.value),
              batchNumber: line.batchNumber ?? null,
            })),
          }
        : {}),
    };
  }

  async list(tenantId: string, query: QueryStockDocumentDto) {
    const [rows, total] = await this.repository.listDocuments(tenantId, {
      docType: query.docType,
      warehouseId: query.warehouseId,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      data: rows.map((row) => this.toResponse(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async get(tenantId: string, id: number): Promise<StockDocumentResponseDto> {
    const document = await this.repository.findDocument(tenantId, id);
    if (!document) {
      throw new NotFoundException(`سند انبار با شناسه ${id} یافت نشد.`);
    }
    return this.toResponse(document, await this.repository.findDocumentLines(tenantId, id));
  }

  /**
   * Transfers stock between two warehouses of the tenant, oldest layers first, keeping each
   * layer's cost and received date. The whole document commits or rolls back together.
   */
  async createTransfer(
    tenantId: string,
    userId: string,
    dto: CreateTransferDto,
  ): Promise<StockDocumentResponseDto> {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('انبار مبدأ و مقصد نباید یکی باشند.');
    }
    const wanted = new Map<string, number>();
    for (const line of dto.lines) {
      const sku = line.sku.trim();
      wanted.set(sku, (wanted.get(sku) ?? 0) + line.quantity);
    }
    const docDate = dto.docDate ?? this.today();

    return this.runNumbered(tenantId, StockDocumentType.TRANSFER, docDate, async (manager, docNumber) => {
      await this.repository.assertActiveWarehouse(tenantId, dto.fromWarehouseId, manager);
      await this.repository.assertActiveWarehouse(tenantId, dto.toWarehouseId, manager);

      const lines: LineInput[] = [];
      for (const [sku, quantity] of wanted) {
        const moved = await this.repository.moveLayers(
          tenantId,
          { sku, quantity, fromWarehouseId: dto.fromWarehouseId, toWarehouseId: dto.toWarehouseId },
          manager,
        );
        const value = this.money(moved.reduce((sum, layer) => sum + layer.quantity * layer.unitCost, 0));
        lines.push({ itemId: null, sku, quantity, unitCost: this.money(value / quantity), value, batchNumber: null });
      }
      return this.save(tenantId, userId, manager, {
        docNumber,
        docType: StockDocumentType.TRANSFER,
        docDate,
        fromWarehouseId: dto.fromWarehouseId,
        toWarehouseId: dto.toWarehouseId,
        reference: dto.reference ?? null,
        note: dto.note ?? null,
      }, lines);
    });
  }

  /** A draft header (no stock moves, no voucher) with a fresh number; used by the opening-balance flow. */
  async createDraft(
    tenantId: string,
    userId: string,
    header: Pick<StockDocumentEntity, 'docType' | 'docDate' | 'toWarehouseId' | 'note'>,
  ): Promise<StockDocumentEntity> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.repository.transaction(async (manager) => {
          await this.repository.assertActiveWarehouse(tenantId, header.toWarehouseId as number, manager);
          const count = await this.repository.countDocuments(tenantId, header.docType, manager);
          const docNumber = `${STOCK_DOCUMENT_PREFIX[header.docType]}-${header.docDate.replace(/-/g, '')}-${String(count + attempt).padStart(5, '0')}`;
          return this.repository.insertDocument(
            tenantId,
            { ...header, docNumber, status: StockDocumentStatus.DRAFT, createdBy: userId },
            [],
            manager,
          );
        }, tenantId);
      } catch (error) {
        if (this.isUniqueViolation(error) && attempt < NUMBER_ATTEMPTS) {
          continue;
        }
        this.rethrow(error);
      }
    }
  }

  /** Runs `work` in one transaction with a fresh document number, retrying if a concurrent document took it. */
  private async runNumbered(
    tenantId: string,
    docType: StockDocumentType,
    docDate: string,
    work: (manager: EntityManager, docNumber: string) => Promise<StockDocumentResponseDto>,
  ): Promise<StockDocumentResponseDto> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.repository.transaction(async (manager) => {
          const count = await this.repository.countDocuments(tenantId, docType, manager);
          const docNumber = `${STOCK_DOCUMENT_PREFIX[docType]}-${docDate.replace(/-/g, '')}-${String(count + attempt).padStart(5, '0')}`;
          return work(manager, docNumber);
        }, tenantId);
      } catch (error) {
        if (this.isUniqueViolation(error) && attempt < NUMBER_ATTEMPTS) {
          continue;
        }
        this.rethrow(error);
      }
    }
  }

  private async save(
    tenantId: string,
    userId: string,
    manager: EntityManager,
    header: Partial<StockDocumentEntity> & { docNumber: string; docType: StockDocumentType; docDate: string },
    lines: LineInput[],
  ): Promise<StockDocumentResponseDto> {
    const document = await this.repository.insertDocument(
      tenantId,
      { ...header, status: StockDocumentStatus.POSTED, createdBy: userId, postedAt: new Date() },
      lines,
      manager,
    );
    return this.toResponse(
      document,
      lines.map((line, index) => ({ ...line, id: index + 1, tenantId, documentId: document.id })),
    );
  }

  private requireInventory(): InventoryService {
    if (!this.inventory) {
      throw new Error('StockDocumentsService needs InventoryService for receipts, deliveries and adjustments.');
    }
    return this.inventory;
  }

  /** Goods received into a warehouse: one new FIFO layer per line at the stated cost. No voucher; the purchase invoice books the money. */
  async createReceipt(tenantId: string, userId: string, dto: CreateReceiptDto): Promise<StockDocumentResponseDto> {
    const inventory = this.requireInventory();
    const docDate = dto.docDate ?? this.today();
    return this.runNumbered(tenantId, StockDocumentType.PURCHASE_RECEIPT, docDate, async (manager, docNumber) => {
      await this.repository.assertActiveWarehouse(tenantId, dto.toWarehouseId, manager);
      const lines: LineInput[] = [];
      for (const line of dto.lines) {
        const result = await inventory.receiveStock(
          tenantId,
          {
            sku: line.sku.trim(),
            quantity: line.quantity,
            unitPurchaseCost: line.unitCost,
            warehouseId: dto.toWarehouseId,
            batchNumber: line.batchNumber,
            receivedAt: `${docDate}T12:00:00.000Z`,
            reference: dto.reference,
          },
          manager,
        );
        lines.push({
          itemId: null,
          sku: line.sku.trim(),
          quantity: line.quantity,
          unitCost: line.unitCost,
          value: result.totalCost,
          batchNumber: result.layers[0]?.batchNumber ?? line.batchNumber ?? null,
        });
      }
      return this.save(tenantId, userId, manager, {
        docNumber,
        docType: StockDocumentType.PURCHASE_RECEIPT,
        docDate,
        toWarehouseId: dto.toWarehouseId,
        reference: dto.reference ?? null,
        note: dto.note ?? null,
      }, lines);
    });
  }

  /** Goods leaving a warehouse at FIFO cost. No voucher; the sales invoice books revenue and cost. */
  async createDelivery(tenantId: string, userId: string, dto: CreateDeliveryDto): Promise<StockDocumentResponseDto> {
    const inventory = this.requireInventory();
    const docDate = dto.docDate ?? this.today();
    return this.runNumbered(tenantId, StockDocumentType.SALES_DELIVERY, docDate, async (manager, docNumber) => {
      await this.repository.assertActiveWarehouse(tenantId, dto.fromWarehouseId, manager);
      const lines: LineInput[] = [];
      for (const line of dto.lines) {
        const result = await inventory.issueStock(
          tenantId,
          { sku: line.sku.trim(), quantity: line.quantity, warehouseId: dto.fromWarehouseId, reference: dto.reference },
          manager,
        );
        lines.push({
          itemId: null,
          sku: line.sku.trim(),
          quantity: line.quantity,
          unitCost: this.money(result.totalCost / line.quantity),
          value: result.totalCost,
          batchNumber: null,
        });
      }
      return this.save(tenantId, userId, manager, {
        docNumber,
        docType: StockDocumentType.SALES_DELIVERY,
        docDate,
        fromWarehouseId: dto.fromWarehouseId,
        reference: dto.reference ?? null,
        note: dto.note ?? null,
      }, lines);
    });
  }

  /**
   * Stocktake correction: positive lines add a layer at the stated cost, negative lines take
   * stock out at FIFO cost, and one voucher moves the net value between inventory and the
   * stock gain/loss account so the ledger keeps agreeing with the shelf.
   */
  async createAdjustment(tenantId: string, userId: string, dto: CreateAdjustmentDto): Promise<StockDocumentResponseDto> {
    const inventory = this.requireInventory();
    const docDate = dto.docDate ?? this.today();
    for (const line of dto.lines) {
      if (line.quantity === 0) {
        throw new BadRequestException(`مقدار تعدیل کالای ${line.sku} صفر است.`);
      }
      if (line.quantity > 0 && !line.unitCost) {
        throw new BadRequestException(`برای اضافه‌شدن کالای ${line.sku} بهای واحد لازم است.`);
      }
    }
    const accounts = await this.resolveAccounts(tenantId, [STOCK_INVENTORY_ACCOUNT, STOCK_ADJUSTMENT_ACCOUNT]);
    return this.runNumbered(tenantId, StockDocumentType.ADJUSTMENT, docDate, async (manager, docNumber) => {
      await this.repository.assertActiveWarehouse(tenantId, dto.warehouseId, manager);
      const lines: LineInput[] = [];
      let net = 0n;
      for (const line of dto.lines) {
        const sku = line.sku.trim();
        if (line.quantity > 0) {
          const result = await inventory.receiveStock(
            tenantId,
            {
              sku,
              quantity: line.quantity,
              unitPurchaseCost: line.unitCost as number,
              warehouseId: dto.warehouseId,
              receivedAt: `${docDate}T12:00:00.000Z`,
              reference: dto.reason,
            },
            manager,
          );
          net += toMinor(result.totalCost);
          lines.push({ itemId: null, sku, quantity: line.quantity, unitCost: line.unitCost as number, value: result.totalCost, batchNumber: null });
        } else {
          const take = Math.abs(line.quantity);
          const result = await inventory.issueStock(
            tenantId,
            { sku, quantity: take, warehouseId: dto.warehouseId, reference: dto.reason },
            manager,
          );
          net -= toMinor(result.totalCost);
          lines.push({ itemId: null, sku, quantity: line.quantity, unitCost: this.money(result.totalCost / take), value: -result.totalCost, batchNumber: null });
        }
      }
      const document = await this.save(tenantId, userId, manager, {
        docNumber,
        docType: StockDocumentType.ADJUSTMENT,
        docDate,
        toWarehouseId: dto.warehouseId,
        reference: dto.reason,
      }, lines);
      if (net !== 0n) {
        const entry = await this.postValueEntry(
          tenantId,
          { id: document.id, docNumber, docDate },
          'adjustment',
          `تعدیل موجودی ${docNumber}: ${dto.reason}`,
          accounts,
          net,
          manager,
        );
        await manager.update('erp_stock_documents', { id: document.id, tenantId }, { journalEntryId: entry.id });
        document.journalEntryId = entry.id;
      }
      return document;
    });
  }

  /**
   * One voucher for a net change in stock value, posted through the posting rules engine:
   * positive debits inventory and credits the counter account, negative the reverse.
   */
  async postValueEntry(
    tenantId: string,
    source: { id: number | string; docNumber: string; docDate: string },
    kind: StockValueKind,
    description: string,
    accounts: string[],
    net: bigint,
    manager: EntityManager,
  ): Promise<{ id: number }> {
    if (!this.postingRules) {
      throw new Error('StockDocumentsService needs PostingRulesService to post stock vouchers.');
    }
    const result = await this.postingRules.post(
      tenantId,
      {
        docType: stockPostingDocType(kind, net),
        sourceType: STOCK_SOURCE_TYPE,
        sourceId: String(source.id),
        date: `${source.docDate}T12:00:00.000Z`,
        amounts: { amount: net < 0n ? -net : net },
        description,
        entryNumber: `STK-${source.docNumber}`,
        overrides: stockPostingOverrides(kind, accounts),
      },
      manager,
    );
    return { id: result.entryId };
  }

  /**
   * Account codes by spec, chosen by `decideRoleAccount`: a matching postable account of the same
   * type (default code first, else lowest), else a new account under the default code, or under
   * the next free code when the default code is taken by an unrelated account.
   */
  async resolveAccounts(tenantId: string, specs: StockAccountSpec[]): Promise<string[]> {
    if (!this.accounting) {
      throw new Error('StockDocumentsService needs AccountingService to resolve accounts.');
    }
    const existing = await this.accounting.listAccounts(tenantId);
    const codes: string[] = [];
    for (const spec of specs) {
      const decision = decideRoleAccount(existing, spec);
      if (decision.action === 'use') {
        codes.push(decision.code);
        continue;
      }
      try {
        const created = await this.accounting.createAccount(tenantId, {
          code: decision.code,
          name: decision.name,
          accountType: decision.accountType,
          currency: Currency.IRR,
        });
        existing.push(created);
        codes.push(created.code);
      } catch {
        codes.push(decision.code);
      }
    }
    return codes;
  }
}
