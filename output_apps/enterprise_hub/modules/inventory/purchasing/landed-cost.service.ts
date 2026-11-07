import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AccountingService } from '../../accounting/services/accounting.service';
import { PeriodLockedException } from '../../accounting/exceptions/ledger.exceptions';
import { mergeRoleAccounts } from '../../invoicing/services/invoice-voucher';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { TenantScope } from '../../access/services/tenant-scope';
import { StockDocumentsService } from '../services/stock-documents.service';
import { InventoryRepository } from '../repositories/inventory.repository';
import { GoodsReceipt } from './purchase.types';
import { PurchaseAccountRole, resolvePurchaseRole } from './purchase-posting.adapter';
import { PurchaseRepository } from './purchase.repository';
import {
  allocateLandedCost,
  LANDED_COST_CATEGORY_LABEL,
  LandedCostBasis,
  LandedCostCategory,
  LandedCostError,
  LandedCostShare,
  layerRaise,
  splitShare,
} from './landed-cost.domain';
import {
  LandedCost,
  LandedCostRepository,
  NewLandedCostAllocation,
} from './landed-cost.repository';
import { CreateLandedCostDto, LandedCostResponseDto } from './landed-cost.dto';

const NOT_FOUND_RECEIPT = 'رسید کالا یافت نشد.';

/** Posting engine document type and source of a landed-cost voucher (one voucher per landed-cost id). */
export const LANDED_COST_DOC_TYPE = 'purchase.landed_cost';
export const LANDED_COST_SOURCE_TYPE = 'landed_cost';

function toResponse(landedCost: LandedCost): LandedCostResponseDto {
  return {
    id: landedCost.id,
    tenantId: landedCost.tenantId,
    receiptId: landedCost.receiptId,
    category: landedCost.category,
    basis: landedCost.basis,
    amount: landedCost.amount.toString(),
    date: landedCost.date,
    supplierCode: landedCost.supplierCode,
    reference: landedCost.reference,
    idempotencyKey: landedCost.idempotencyKey,
    createdBy: landedCost.createdBy,
    inventoryAmount: landedCost.inventoryAmount.toString(),
    cogsAmount: landedCost.cogsAmount.toString(),
    journalEntryId: landedCost.journalEntryId,
    createdAt: landedCost.createdAt,
    allocations: landedCost.allocations.map((allocation) => ({
      id: allocation.id,
      receiptLineId: allocation.receiptLineId,
      sku: allocation.sku,
      quantity: allocation.quantity.toString(),
      basisValue: allocation.basisValue.toString(),
      share: allocation.share.toString(),
      toInventory: allocation.toInventory.toString(),
      toCogs: allocation.toCogs.toString(),
      fifoBatchId: allocation.fifoBatchId,
    })),
  };
}

/**
 * Landed costs (#227 T2, docs/accounting/PURCHASE_CYCLE.md): a freight, customs, insurance or
 * other surcharge on one goods receipt. The amount is split over the receipt lines by the largest
 * remainder (`landed-cost.domain.ts`), each line's share is split between its FIFO layer (still on
 * hand; the layer's unit cost is raised) and what was already issued (COGS), and one voucher is
 * posted through the posting engine (template `purchase.landed_cost`). Everything is one
 * transaction: the layers are locked FOR UPDATE, so a late cost never changes history.
 */
@Injectable()
export class LandedCostService {
  constructor(
    private readonly scope: TenantScope,
    private readonly purchases: PurchaseRepository,
    private readonly landedCosts: LandedCostRepository,
    private readonly inventoryRepository: InventoryRepository,
    private readonly stockDocuments: StockDocumentsService,
    private readonly postingRules: PostingRulesService,
    private readonly accounting: AccountingService,
  ) {}

  /** Domain errors are all client errors: a bad amount, a missing weight or nothing to allocate. */
  private allocateOrThrow(
    amount: bigint,
    lines: GoodsReceipt['lines'],
    basis: LandedCostBasis,
  ): LandedCostShare[] {
    try {
      return allocateLandedCost(amount, lines, basis);
    } catch (error) {
      if (error instanceof LandedCostError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async createLandedCost(
    tenantId: string,
    userId: string,
    receiptId: string,
    dto: CreateLandedCostDto,
  ): Promise<LandedCostResponseDto> {
    return this.scope.run(tenantId, async (manager) => {
      const idempotencyKey = dto.idempotencyKey ?? null;
      if (idempotencyKey) {
        const existing = await this.landedCosts.findByIdempotencyKey(tenantId, idempotencyKey, manager);
        if (existing) return toResponse(existing);
      }

      // Refused before anything is written: a locked period takes no landed cost.
      const date = new Date(`${dto.date}T00:00:00.000Z`);
      if (await this.accounting.isPeriodLocked(tenantId, date)) {
        throw new PeriodLockedException(
          `ثبت سند در دورهٔ قفل‌شده مجاز نیست: تاریخ ${dto.date} در دوره یا سال مالی بسته قرار دارد.`,
        );
      }

      const receipt = await this.purchases.findReceipt(tenantId, receiptId, manager, true);
      if (!receipt) throw new NotFoundException(NOT_FOUND_RECEIPT);
      const shares = this.allocateOrThrow(BigInt(dto.amount), receipt.lines, dto.basis);

      // The line keeps the FIFO batch it created; without it the on-hand / sold split is unknown.
      const batchIds = shares.map((entry) => entry.line.fifoBatchId);
      if (batchIds.some((batchId) => batchId === null)) {
        throw new ConflictException(
          'سطرهای این رسید به لایه موجودی FIFO پیوند ندارند و هزینه قابل تخصیص نیست.',
        );
      }
      const layers = await this.inventoryRepository.lockFifoBatchesByIds(
        tenantId,
        batchIds as number[],
        manager,
      );

      const prepared = shares.map((entry) => {
        const fifoBatchId = entry.line.fifoBatchId as number;
        const layer = layers.get(fifoBatchId);
        if (!layer) {
          throw new ConflictException(
            `لایه موجودی سطر کالای «${entry.line.sku}» یافت نشد و هزینه قابل تخصیص نیست.`,
          );
        }
        const split = splitShare(entry.share, entry.line.quantity, layer.quantityRemaining);
        const { raisePerUnit } = layerRaise(split.toInventory, layer.quantityRemaining);
        const allocation: NewLandedCostAllocation = {
          receiptLineId: entry.line.id,
          sku: entry.line.sku,
          quantity: entry.line.quantity,
          basisValue: entry.basisValue,
          share: entry.share,
          toInventory: split.toInventory,
          toCogs: split.toCogs,
          fifoBatchId,
        };
        return { allocation, raisePerUnit };
      });

      const inventoryAmount = prepared.reduce((sum, entry) => sum + entry.allocation.toInventory, 0n);
      const cogsAmount = prepared.reduce((sum, entry) => sum + entry.allocation.toCogs, 0n);

      const landedCost = await this.landedCosts.insertLandedCost(
        tenantId,
        {
          receiptId: receipt.id,
          category: dto.category,
          basis: dto.basis,
          amount: BigInt(dto.amount),
          date: dto.date,
          supplierCode: dto.supplierCode.trim(),
          reference: dto.reference.trim(),
          idempotencyKey,
          createdBy: userId,
          inventoryAmount,
          cogsAmount,
        },
        prepared.map((entry) => entry.allocation),
        manager,
      );

      // The share still on hand raises its layer's unit cost; the rounding remainder of that
      // division stays in the voucher's INVENTORY line, never lost.
      for (const entry of prepared) {
        if (entry.raisePerUnit > 0n) {
          await this.inventoryRepository.raiseLayerUnitCostByMinor(
            tenantId,
            entry.allocation.fifoBatchId as number,
            entry.raisePerUnit,
            manager,
          );
        }
      }

      const journalEntryId = await this.postVoucher(tenantId, receipt, landedCost, manager);
      await this.landedCosts.markPosted(tenantId, landedCost.id, journalEntryId, manager);
      return toResponse({ ...landedCost, journalEntryId });
    });
  }

  /**
   * Posts INVENTORY (still on hand) + COGS (already issued) against the supplier payable through
   * the posting engine. Accounts resolve by role like the goods receipt, and a tenant mapping wins.
   */
  private async postVoucher(
    tenantId: string,
    receipt: GoodsReceipt,
    landedCost: LandedCost,
    manager: EntityManager,
  ): Promise<string> {
    const [inventoryCode, cogsCode, payableCode] = await this.stockDocuments.resolveAccounts(tenantId, [
      resolvePurchaseRole(PurchaseAccountRole.INVENTORY),
      resolvePurchaseRole(PurchaseAccountRole.COGS),
      resolvePurchaseRole(PurchaseAccountRole.PAYABLE),
    ]);
    const described = (await this.postingRules.describe(tenantId)).find(
      (entry) => entry.docType === LANDED_COST_DOC_TYPE,
    );
    // Accounts resolved by name above; a mapping the tenant made on the posting-rules page wins.
    const overrides = mergeRoleAccounts(
      { inventory: inventoryCode, cogs: cogsCode, payable: payableCode },
      described,
    );
    const label = LANDED_COST_CATEGORY_LABEL[landedCost.category as LandedCostCategory];
    const result = await this.postingRules.post(
      tenantId,
      {
        docType: LANDED_COST_DOC_TYPE,
        sourceType: LANDED_COST_SOURCE_TYPE,
        sourceId: landedCost.id,
        date: `${landedCost.date}T00:00:00.000Z`,
        amounts: {
          inventory: landedCost.inventoryAmount,
          cogs: landedCost.cogsAmount,
          payable: landedCost.amount,
        },
        description: `هزینه ${label} رسید ${receipt.number} (ارجاع ${landedCost.reference})`,
        partyCode: landedCost.supplierCode,
        entryNumber: `LC-${landedCost.id}`,
        overrides,
      },
      manager,
    );
    return String(result.entryId);
  }
}
