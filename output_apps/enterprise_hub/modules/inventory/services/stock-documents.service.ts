import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MONEY_SCALE } from '../constants/inventory.constants';
import {
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

/** Postgres unique-violation code. */
const UNIQUE_VIOLATION = '23505';
const NUMBER_ATTEMPTS = 4;

/** Stock documents: every stock event is one numbered document with its lines. */
@Injectable()
export class StockDocumentsService {
  constructor(private readonly repository: StockDocumentsRepository) {}

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

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.repository.transaction(async (manager) => {
          await this.repository.assertActiveWarehouse(tenantId, dto.fromWarehouseId, manager);
          await this.repository.assertActiveWarehouse(tenantId, dto.toWarehouseId, manager);

          const lines: Array<Omit<StockDocumentLineEntity, 'id' | 'tenantId' | 'documentId'>> = [];
          for (const [sku, quantity] of wanted) {
            const moved = await this.repository.moveLayers(
              tenantId,
              {
                sku,
                quantity,
                fromWarehouseId: dto.fromWarehouseId,
                toWarehouseId: dto.toWarehouseId,
              },
              manager,
            );
            const value = this.money(moved.reduce((sum, layer) => sum + layer.quantity * layer.unitCost, 0));
            lines.push({
              itemId: null,
              sku,
              quantity,
              unitCost: this.money(value / quantity),
              value,
              batchNumber: null,
            });
          }

          const count = await this.repository.countDocuments(tenantId, StockDocumentType.TRANSFER, manager);
          const docNumber = `${STOCK_DOCUMENT_PREFIX[StockDocumentType.TRANSFER]}-${docDate.replace(/-/g, '')}-${String(count + attempt).padStart(5, '0')}`;
          const document = await this.repository.insertDocument(
            tenantId,
            {
              docNumber,
              docType: StockDocumentType.TRANSFER,
              status: StockDocumentStatus.POSTED,
              docDate,
              fromWarehouseId: dto.fromWarehouseId,
              toWarehouseId: dto.toWarehouseId,
              reference: dto.reference ?? null,
              note: dto.note ?? null,
              createdBy: userId,
              postedAt: new Date(),
            },
            lines,
            manager,
          );
          return this.toResponse(
            document,
            lines.map((line, index) => ({ ...line, id: index + 1, tenantId, documentId: document.id })),
          );
        });
      } catch (error) {
        if (this.isUniqueViolation(error) && attempt < NUMBER_ATTEMPTS) {
          continue;
        }
        this.rethrow(error);
      }
    }
  }
}
