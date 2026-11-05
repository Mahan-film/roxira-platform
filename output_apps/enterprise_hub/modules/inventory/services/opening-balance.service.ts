import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { toMinor } from '../../accounting/money';
import {
  OPENING_STOCK_EQUITY_ACCOUNT,
  STOCK_INVENTORY_ACCOUNT,
} from '../constants/stock-accounts';
import {
  CreateOpeningDraftDto,
  OpeningLineDto,
  OpeningProblemDto,
  OpeningReviewDto,
  PostOpeningDto,
} from '../dto/opening-balance.dto';
import { StockDocumentEntity, StockDocumentLineEntity } from '../entities/stock-document.entity';
import {
  STOCK_DOCUMENT_PREFIX,
  StockDocumentStatus,
  StockDocumentType,
} from '../enums/stock-document.enum';
import { StockDocumentsRepository } from '../repositories/stock-documents.repository';
import { InventoryService } from './inventory.service';
import { StockDocumentsService } from './stock-documents.service';

const TEMPLATE_LIMIT = 50000;

/**
 * Opening balances for items that were imported without stock. Nothing is invented: the draft
 * holds only the quantities and costs a person entered or uploaded, a review lists every
 * problem and the totals, and posting needs the exact figures of that review echoed back.
 * Posting creates one FIFO layer per line dated at the as-of date and one voucher
 * (inventory / opening stock equity).
 */
@Injectable()
export class OpeningBalanceService {
  constructor(
    private readonly repository: StockDocumentsRepository,
    private readonly documents: StockDocumentsService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

  private money(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private async draft(tenantId: string, id: number): Promise<StockDocumentEntity> {
    const document = await this.repository.findDocument(tenantId, id);
    if (!document || document.docType !== StockDocumentType.OPENING) {
      throw new NotFoundException('پیش‌نویس موجودی اول دوره یافت نشد.');
    }
    return document;
  }

  private async editableDraft(tenantId: string, id: number): Promise<StockDocumentEntity> {
    const document = await this.draft(tenantId, id);
    if (document.status !== StockDocumentStatus.DRAFT) {
      throw new ConflictException('این سند ثبت نهایی شده و قابل تغییر نیست.');
    }
    return document;
  }

  /** A new empty draft for one warehouse and as-of date. */
  async createDraft(tenantId: string, userId: string, dto: CreateOpeningDraftDto): Promise<OpeningReviewDto> {
    const document = await this.documents.createDraft(tenantId, userId, {
      docType: StockDocumentType.OPENING,
      docDate: dto.docDate,
      toWarehouseId: dto.toWarehouseId,
      note: dto.note ?? null,
    });
    return this.review(tenantId, document.id);
  }

  /** Replaces the draft's lines (a CSV upload or a manual edit) and clears the review. */
  async replaceLines(tenantId: string, id: number, lines: OpeningLineDto[]): Promise<OpeningReviewDto> {
    await this.editableDraft(tenantId, id);
    // Lines the person left empty (quantity 0) are dropped, never defaulted.
    const kept = lines
      .map((line) => ({ sku: line.sku.trim(), quantity: line.quantity, unitCost: line.unitCost }))
      .filter((line) => line.sku !== '' && line.quantity !== 0);
    await this.repository.transaction(async (manager) => {
      await this.repository.replaceLines(
        tenantId,
        id,
        kept.map((line) => ({
          itemId: null,
          sku: line.sku,
          quantity: line.quantity,
          unitCost: line.unitCost,
          value: this.money(line.quantity * line.unitCost),
          batchNumber: null,
        })),
        manager,
      );
      await this.repository.updateDocument(tenantId, id, { reviewedAt: null, reviewedBy: null }, manager);
    });
    return this.review(tenantId, id);
  }

  async deleteDraft(tenantId: string, id: number): Promise<void> {
    await this.editableDraft(tenantId, id);
    await this.repository.transaction((manager) => this.repository.deleteDraft(tenantId, id, manager));
  }

  /** Totals and every problem in the current lines; computed fresh each time. */
  async review(tenantId: string, id: number): Promise<OpeningReviewDto> {
    const document = await this.draft(tenantId, id);
    const lines = await this.repository.findDocumentLines(tenantId, id);
    const warehouseId = document.toWarehouseId as number;
    const problems = await this.problemsOf(tenantId, warehouseId, lines, document.status === StockDocumentStatus.DRAFT);
    const totalValue = this.money(lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitCost), 0));
    const stillWithout = (await this.repository.itemsWithoutStock(tenantId, TEMPLATE_LIMIT)).filter(
      (item) => !lines.some((l) => l.sku === item.sku),
    ).length;
    return {
      documentId: document.id,
      docNumber: document.docNumber,
      status: document.status as 'DRAFT' | 'POSTED',
      docDate: String(document.docDate).slice(0, 10),
      warehouseId,
      lineCount: lines.length,
      totalValue,
      itemsStillWithoutStock: stillWithout,
      problems,
      reviewed: document.reviewedAt !== null && document.reviewedAt !== undefined,
      canPost:
        document.status === StockDocumentStatus.DRAFT &&
        lines.length > 0 &&
        problems.length === 0 &&
        document.reviewedAt !== null &&
        document.reviewedAt !== undefined,
    };
  }

  private async problemsOf(
    tenantId: string,
    warehouseId: number,
    lines: StockDocumentLineEntity[],
    checkShelf: boolean,
  ): Promise<OpeningProblemDto[]> {
    const problems: OpeningProblemDto[] = [];
    const skus = [...new Set(lines.map((l) => l.sku))];
    const [known, withStock] = await Promise.all([
      this.repository.existingSkus(tenantId, skus),
      checkShelf ? this.repository.skusWithStockIn(tenantId, warehouseId, skus) : Promise.resolve(new Set<string>()),
    ]);
    const seen = new Set<string>();
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const cost = Number(line.unitCost);
      if (!known.has(line.sku)) {
        problems.push({ sku: line.sku, code: 'UNKNOWN_SKU', message: `کالایی با کد ${line.sku} در فهرست نیست.` });
      }
      if (seen.has(line.sku)) {
        problems.push({ sku: line.sku, code: 'DUPLICATE_SKU', message: `کد ${line.sku} بیش از یک بار آمده است.` });
      }
      seen.add(line.sku);
      if (quantity < 0) {
        problems.push({ sku: line.sku, code: 'BAD_QUANTITY', message: `مقدار ${line.sku} منفی است؛ موجودی اول دوره فقط مثبت است.` });
      }
      if (quantity > 0 && !(cost > 0)) {
        problems.push({ sku: line.sku, code: 'MISSING_COST', message: `بهای واحد ${line.sku} وارد نشده است؛ بها حدس زده نمی‌شود.` });
      }
      if (withStock.has(line.sku)) {
        problems.push({
          sku: line.sku,
          code: 'ALREADY_HAS_STOCK',
          message: `${line.sku} در این انبار موجودی دارد؛ موجودی اول دوره روی آن دوبار شمرده می‌شود.`,
        });
      }
    }
    return problems;
  }

  /** The person confirms they looked at the summary of exactly these lines. */
  async markReviewed(tenantId: string, userId: string, id: number): Promise<OpeningReviewDto> {
    await this.editableDraft(tenantId, id);
    await this.repository.updateDocument(tenantId, id, { reviewedAt: new Date(), reviewedBy: userId });
    return this.review(tenantId, id);
  }

  /**
   * Final posting. Needs a clean, current review, and the line count and total the poster saw.
   * One transaction: every layer, the voucher and the status change commit together.
   */
  async post(tenantId: string, userId: string, id: number, confirm: PostOpeningDto): Promise<OpeningReviewDto> {
    const document = await this.editableDraft(tenantId, id);
    const summary = await this.review(tenantId, id);
    if (summary.lineCount === 0) {
      throw new BadRequestException('سند هیچ سطری ندارد.');
    }
    if (summary.problems.length > 0) {
      throw new BadRequestException('ابتدا مشکلات بازبینی را برطرف کنید.');
    }
    if (!document.reviewedAt) {
      throw new BadRequestException('ابتدا سطرها را بازبینی و تأیید کنید.');
    }
    if (confirm.lineCount !== summary.lineCount || Math.abs(confirm.totalValue - summary.totalValue) > 0.005) {
      throw new ConflictException('مبالغ تأییدشده با سطرهای فعلی نمی‌خواند؛ دوباره بازبینی کنید.');
    }
    if (!this.inventory) {
      throw new Error('OpeningBalanceService needs InventoryService to post.');
    }
    const inventory = this.inventory;
    const lines = await this.repository.findDocumentLines(tenantId, id);
    const accounts = await this.documents.resolveAccounts(tenantId, [
      STOCK_INVENTORY_ACCOUNT,
      OPENING_STOCK_EQUITY_ACCOUNT,
    ]);
    const docDate = String(document.docDate).slice(0, 10);

    await this.repository.transaction(async (manager) => {
      await this.repository.assertActiveWarehouse(tenantId, document.toWarehouseId as number, manager);
      let net = 0n;
      for (const line of lines) {
        const result = await inventory.receiveStock(
          tenantId,
          {
            sku: line.sku,
            quantity: Number(line.quantity),
            unitPurchaseCost: Number(line.unitCost),
            warehouseId: document.toWarehouseId as number,
            batchNumber: `OPEN-${docDate.replace(/-/g, '')}`,
            receivedAt: `${docDate}T00:00:00.000Z`,
            reference: `${STOCK_DOCUMENT_PREFIX[StockDocumentType.OPENING]} ${document.docNumber}`,
          },
          manager,
        );
        net += toMinor(result.totalCost);
      }
      const entry = await this.documents.postValueEntry(
        tenantId,
        { id, docNumber: document.docNumber, docDate },
        'opening',
        `موجودی اول دوره ${document.docNumber}`,
        accounts,
        net,
        manager,
      );
      await this.repository.updateDocument(
        tenantId,
        id,
        { status: StockDocumentStatus.POSTED, postedAt: new Date(), journalEntryId: entry.id, createdBy: document.createdBy ?? userId },
        manager,
      );
    });
    return this.review(tenantId, id);
  }

  /**
   * CSV to fill in: every item that has no stock yet, with empty quantity and cost columns.
   * Left empty means "not counted", never zero or a default.
   */
  async template(tenantId: string): Promise<string> {
    const items = await this.repository.itemsWithoutStock(tenantId, TEMPLATE_LIMIT);
    const escape = (value: string) => {
      const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return [
      'sku,barcode,name,quantity,unit_cost',
      ...items.map((item) => [escape(item.sku), escape(item.barcode), escape(item.name), '', ''].join(',')),
    ].join('\n');
  }
}
