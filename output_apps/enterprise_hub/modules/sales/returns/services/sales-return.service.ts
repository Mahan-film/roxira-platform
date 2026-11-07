import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { parseScaled, toMinor, minorToDecimal, fromMinor } from '../../../accounting/money';
import { SalesDeliveryRepository } from '../delivery/repositories/sales-delivery.repository';
import { SalesDeliveryLineEntity } from '../delivery/entities/sales-delivery.entity';
import { CreateReturnDto, ReturnResponseDto, ReturnLineResponseDto } from '../dto/sales-return.dto';
import { InvoiceDirection, InvoiceSubject } from '../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import { InvoicingRepository } from '../../invoicing/repositories/invoicing.repository';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { PostingRole } from '../../posting_rules/constants/posting-roles';
import { COGS_SOURCE_TYPE, unitCostMinor as calcUnitCostMinor } from '../delivery/delivery-math';
import { COGS_DOC_TYPE, COGS_ENTRY_PREFIX } from '../delivery/delivery-math';
import { STOCK_INVENTORY_ACCOUNT } from '../../inventory/constants/stock-accounts';
import { COGS_ACCOUNT } from '../../invoicing/constants/suite-events.constants';
import { documentRows, drCrAmounts, documentDocType } from '../../invoicing/services/invoice-voucher';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';

const QUANTITY_SCALE = 2;
const IDEMPOTENCY_CONSTRAINT = 'idempotency';

function isUniqueViolationOn(error: unknown, part: string): boolean {
  const e = error as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  const code = e?.code ?? e?.driverError?.code;
  const constraint = (e?.constraint ?? e?.driverError?.constraint ?? '').toLowerCase();
  return code === '23505' && constraint.includes(part);
}

interface ReturnLineDetail {
  deliveryLine: SalesDeliveryLineEntity;
  quantityHundredths: bigint;
  unitCostMinor: bigint;
  lineCostMinor: bigint;
  originalInvoiceLine: {
    unitPrice: number;
    vatRate: number;
    discount: number;
    description: string;
    sku: string | null;
    itemId: number | null;
  };
}

interface PostedAmounts {
  receivable: bigint;
  vat: bigint;
  net: bigint;
  stock: bigint;
}

@Injectable()
export class SalesReturnService {
  private readonly logger = new Logger(SalesReturnService.name);

  constructor(
    private readonly deliveries: SalesDeliveryRepository,
    private readonly invoicingRepo: InvoicingRepository,
    private readonly invoicingService: InvoicingService,
    private readonly inventoryService: InventoryService,
    private readonly postingRules: PostingRulesService,
  ) {}

  /**
   * Creates a RETURN invoice for a sales delivery invoice.
   * One transaction: lock delivery lines, validate quantity, create RETURN invoice,
   * return stock at original delivery line cost, post COGS reversal, bump returned_quantity.
   */
  async createReturn(
    tenantId: string,
    invoiceId: string,
    dto: CreateReturnDto,
    userId?: string,
  ): Promise<ReturnResponseDto> {
    // Check idempotency key first (outside transaction for early return)
    if (dto.idempotencyKey) {
      const existing = await this.invoicingRepo.findByIdempotencyKey(tenantId, dto.idempotencyKey);
      if (existing) {
        return this.toResponseDto(existing);
      }
    }

    return await this.invoicingRepo.transaction(async (manager) => {
      // 1. Lock delivery lines FOR UPDATE and validate
      const { deliveryLines, errors } = await this.deliveries.lockDeliveryLinesForReturn(
        tenantId,
        invoiceId,
        dto.lines,
        manager,
      );

      if (errors.length > 0) {
        const error = errors[0];
        if (error.code === '400') {
          throw new BadRequestException(error.message);
        }
        if (error.code === '409') {
          throw new ConflictException(error.message);
        }
        throw new BadRequestException(error.message);
      }

      // 2. Get the original invoice (the one we're returning against)
      const originalInvoice = await this.invoicingRepo.findById(tenantId, invoiceId);
      if (!originalInvoice) {
        throw new NotFoundException('صورتحساب مرجع یافت نشد.');
      }
      if (
        (originalInvoice.direction ?? InvoiceDirection.SALE) !== InvoiceDirection.SALE ||
        (originalInvoice.subject ?? InvoiceSubject.ORIGINAL) !== InvoiceSubject.ORIGINAL
      ) {
        throw new BadRequestException('فقط صورتحساب فروش اصلی قابل برگشت است.');
      }

      // 3. Build return line details with original invoice line data
      const lineDetails = await this.buildReturnLineDetails(
        tenantId,
        manager,
        originalInvoice,
        deliveryLines,
        dto.lines,
      );

      // 4. Calculate return invoice totals (revenue/VAT reversal at original rates)
      const returnItems = this.buildReturnInvoiceItems(lineDetails);
      const totals = this.computeReturnTotals(returnItems, originalInvoice.currency);

      // 5. Create RETURN invoice in this transaction
      const returnInvoice = await this.createReturnInvoiceInTransaction(
        tenantId,
        manager,
        originalInvoice,
        returnItems,
        totals,
        dto,
        userId,
      );

      // 6. Return stock to warehouse at original delivery line unit cost
      // 7. Post COGS reversal at original delivery line cost
      const totalCogsReversalMinor = await this.processStockReturnAndCogsReversal(
        tenantId,
        manager,
        returnInvoice,
        lineDetails,
        dto.returnDate,
      );

      // 8. Update returned_quantity on delivery lines
      await this.updateReturnedQuantities(tenantId, manager, lineDetails);

      // 9. Update return invoice with posting meta
      await this.updateReturnInvoicePostingMeta(
        tenantId,
        manager,
        returnInvoice,
        lineDetails,
        totalCogsReversalMinor,
      );

      // 10. Post the RETURN invoice voucher (revenue/VAT reversal) synchronously
      const entryId = await this.postReturnInvoiceVoucher(
        tenantId,
        manager,
        returnInvoice,
        totals,
        dto.returnDate,
      );

      // Update invoice with journal entry ID
      await manager.getRepository(InvoiceEntity).update(
        { tenantId, id: returnInvoice.id },
        { journalEntryId: entryId },
      );

      // Reload the invoice with updated posting info
      const savedInvoice = await this.invoicingRepo.findByIdForPosting(tenantId, returnInvoice.id, manager);
      return this.toResponseDto(savedInvoice!);
    });
  }

  /**
   * Builds detailed return line information including delivery line cost and original invoice line data.
   */
  private async buildReturnLineDetails(
    tenantId: string,
    manager: EntityManager,
    originalInvoice: InvoiceEntity,
    deliveryLines: SalesDeliveryLineEntity[],
    requestLines: Array<{ deliveryLineId: number; quantity: number }>,
  ): Promise<ReturnLineDetail[]> {
    const deliveryLineMap = new Map(deliveryLines.map((dl) => [dl.id, dl]));

    // Map original invoice lines by SKU for matching
    const invoiceLineBySku = new Map<string, any>();
    for (const line of originalInvoice.items ?? []) {
      if (line.sku && !invoiceLineBySku.has(line.sku)) {
        invoiceLineBySku.set(line.sku, line);
      }
    }

    const details: ReturnLineDetail[] = [];

    for (const reqLine of requestLines) {
      const deliveryLine = deliveryLineMap.get(reqLine.deliveryLineId);
      if (!deliveryLine) {
        throw new BadRequestException(`خط برگشتی ${reqLine.deliveryLineId} به صورتحساب مرجع تعلق ندارد.`);
      }

      const quantityHundredths = parseScaled(reqLine.quantity, QUANTITY_SCALE);
      if (quantityHundredths <= 0n) {
        throw new BadRequestException('مقدار برگشتی باید مثبت باشد.');
      }

      // Calculate unit cost from delivery line (in minor units)
      const lineCostMinor = toMinor(deliveryLine.lineCost);
      const deliveryQuantityHundredths = parseScaled(deliveryLine.quantity, QUANTITY_SCALE);
      const unitCostMinor = calcUnitCostMinor(lineCostMinor, deliveryQuantityHundredths);

      // Find matching original invoice line by SKU
      const originalInvoiceLine = deliveryLine.sku
        ? invoiceLineBySku.get(deliveryLine.sku)
        : null;

      if (!originalInvoiceLine) {
        throw new BadRequestException(`سطر صورتحساب اصلی برای کالای ${deliveryLine.sku} یافت نشد.`);
      }

      // Validate quantity against invoiced - already returned
      const invoicedQuantity = parseScaled(deliveryLine.invoicedQuantity, QUANTITY_SCALE);
      const returnedQuantity = parseScaled(deliveryLine.returnedQuantity, QUANTITY_SCALE);
      const maxReturnable = invoicedQuantity - returnedQuantity;
      if (quantityHundredths > maxReturnable) {
        throw new ConflictException(
          `مقدار برگشتی خط ${reqLine.deliveryLineId} از باقی‌ماندهٔ قابل برگشت (${Number(maxReturnable) / 100}) بیشتر است.`,
        );
      }

      details.push({
        deliveryLine,
        quantityHundredths,
        unitCostMinor,
        lineCostMinor: (unitCostMinor * quantityHundredths + 50n) / 100n, // round half up
        originalInvoiceLine: {
          unitPrice: originalInvoiceLine.unitPrice,
          vatRate: originalInvoiceLine.vatRate,
          discount: originalInvoiceLine.discount ?? 0,
          description: originalInvoiceLine.description,
          sku: originalInvoiceLine.sku,
          itemId: originalInvoiceLine.itemId,
        },
      });
    }

    return details;
  }

  /**
   * Builds return invoice items mirroring original invoice lines (price, VAT, proportional discount).
   */
  private buildReturnInvoiceItems(details: ReturnLineDetail[]): any[] {
    return details.map((detail) => {
      const { originalInvoiceLine, quantityHundredths } = detail;
      const quantity = Number(quantityHundredths) / 100;

      // Proportional discount: (returned_qty / invoiced_qty) * line_discount
      const invoicedQty = originalInvoiceLine.quantity;
      const discountRatio = invoicedQty > 0 ? quantity / invoicedQty : 0;
      const discount = Math.round((originalInvoiceLine.discount ?? 0) * discountRatio * 100) / 100;

      const taxable = quantity * originalInvoiceLine.unitPrice - discount;
      const tax = Math.round(taxable * originalInvoiceLine.vatRate * 100) / 100;
      const total = Math.round((taxable + tax) * 100) / 100;

      return {
        ...(originalInvoiceLine.itemId ? { itemId: originalInvoiceLine.itemId } : {}),
        ...(originalInvoiceLine.sku ? { sku: originalInvoiceLine.sku } : {}),
        description: originalInvoiceLine.description,
        quantity,
        unitPrice: originalInvoiceLine.unitPrice,
        discount,
        vatRate: originalInvoiceLine.vatRate,
        tax,
        total,
        originalLine: originalInvoiceLine.originalLine,
      };
    });
  }

  /**
   * Computes totals for the return invoice.
   */
  private computeReturnTotals(items: any[], currency: string): {
    totalAmount: number;
    totalDiscount: number;
    totalTax: number;
    finalPayable: number;
  } {
    let totalAmount = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let finalPayable = 0;

    for (const item of items) {
      totalAmount += item.quantity * item.unitPrice;
      totalDiscount += item.discount;
      totalTax += item.tax;
      finalPayable += item.total;
    }

    const scale = currency === 'IRR' ? 0 : currency === 'IRT' ? 1 : 2;
    const factor = 10 ** scale;

    return {
      totalAmount: Math.round(totalAmount * factor) / factor,
      totalDiscount: Math.round(totalDiscount * factor) / factor,
      totalTax: Math.round(totalTax * factor) / factor,
      finalPayable: Math.round(finalPayable * factor) / factor,
    };
  }

  /**
   * Creates the RETURN invoice in the current transaction.
   */
  private async createReturnInvoiceInTransaction(
    tenantId: string,
    manager: EntityManager,
    originalInvoice: InvoiceEntity,
    returnItems: any[],
    totals: { totalAmount: number; totalDiscount: number; totalTax: number; finalPayable: number },
    dto: CreateReturnDto,
    userId?: string,
  ): Promise<InvoiceEntity> {
    const taxInvoiceNumber = `RET-${originalInvoice.taxInvoiceNumber}-${Date.now()}`;

    const invoiceEntity = {
      taxInvoiceNumber,
      direction: InvoiceDirection.SALE,
      einvoiceType: originalInvoice.einvoiceType ?? 1,
      subject: InvoiceSubject.RETURN,
      relatedInvoiceId: originalInvoice.id,
      warehouseId: originalInvoice.warehouseId ?? null,
      customerId: originalInvoice.customerId ?? null,
      sellerInfo: originalInvoice.sellerInfo,
      buyerInfo: originalInvoice.buyerInfo,
      items: returnItems,
      currency: originalInvoice.currency,
      jurisdiction: originalInvoice.jurisdiction,
      exchangeRate: originalInvoice.exchangeRate,
      fxRate: originalInvoice.fxRate,
      amountFx: totals.finalPayable,
      baseCurrency: originalInvoice.baseCurrency,
      totalAmount: totals.totalAmount,
      totalDiscount: totals.totalDiscount,
      totalTax: totals.totalTax,
      finalPayable: totals.finalPayable,
      baseTotalAmount: Math.round(totals.totalAmount * Number(originalInvoice.exchangeRate) * 100) / 100,
      baseTotalTax: Math.round(totals.totalTax * Number(originalInvoice.exchangeRate) * 100) / 100,
      baseFinalPayable: Math.round(totals.finalPayable * Number(originalInvoice.exchangeRate) * 100) / 100,
      status: InvoiceStatus.ISSUED,
      issuedAt: new Date(),
      idempotencyKey: dto.idempotencyKey ?? null,
      requestHash: dto.idempotencyKey ? this.hashRequest(dto) : null,
      payments: null,
    };

    const repo = manager.getRepository(InvoiceEntity);
    const saved = await repo.save(repo.create({ ...invoiceEntity, tenantId }));
    return saved;
  }

  private hashRequest(dto: CreateReturnDto): string {
    const { idempotencyKey: _key, ...body } = dto;
    return createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }

  /**
   * Returns stock to warehouse at original delivery line unit cost and posts COGS reversal.
   */
  private async processStockReturnAndCogsReversal(
    tenantId: string,
    manager: EntityManager,
    returnInvoice: InvoiceEntity,
    details: ReturnLineDetail[],
    returnDate: string,
  ): Promise<bigint> {
    let totalCogsReversalMinor = 0n;
    const warehouseId = returnInvoice.warehouseId;

    for (const detail of details) {
      const { deliveryLine, quantityHundredths, unitCostMinor, lineCostMinor } = detail;
      const quantity = Number(quantityHundredths) / 100;

      // 1. Receive stock back at original delivery line unit cost
      await this.inventoryService.receiveStock(
        tenantId,
        {
          sku: deliveryLine.sku,
          quantity,
          unitPurchaseCost: Number(minorToDecimal(unitCostMinor)),
          warehouseId: warehouseId ?? undefined,
          reference: `برگشت از صورتحساب ${returnInvoice.taxInvoiceNumber}`,
          receivedAt: returnDate,
        },
        manager,
      );

      // 2. Post COGS reversal through posting engine at same cost
      const sourceId = `${returnInvoice.id}-dl${deliveryLine.id}`;
      const cogsAmountMinor = lineCostMinor;
      totalCogsReversalMinor += cogsAmountMinor;

      if (cogsAmountMinor > 0n) {
        // Get account mapping for COGS template
        const described = await this.postingRules.describe(tenantId);
        const cogsTemplate = described.find((d) => d.docType === COGS_DOC_TYPE);
        const overrides: Partial<Record<PostingRole, string>> = {};
        if (cogsTemplate) {
          for (const role of cogsTemplate.roles) {
            if (role.accountCode) {
              overrides[role.role as PostingRole] = role.accountCode;
            }
          }
        }

        await this.postingRules.post(
          tenantId,
          {
            docType: COGS_DOC_TYPE,
            sourceType: COGS_SOURCE_TYPE,
            sourceId,
            date: returnDate,
            amounts: { cost: -cogsAmountMinor }, // Negative for reversal (credit cogs, debit inventory)
            description: `ابطال بهای تمام‌شده برگشت ${returnInvoice.taxInvoiceNumber} خط ${deliveryLine.lineNo}`,
            entryNumber: `${COGS_ENTRY_PREFIX}-${returnInvoice.id}-${deliveryLine.id}`.slice(0, 64),
            overrides,
          },
          manager,
        );
      }
    }

    return totalCogsReversalMinor;
  }

  /**
   * Updates returned_quantity on delivery lines.
   */
  private async updateReturnedQuantities(
    tenantId: string,
    manager: EntityManager,
    details: ReturnLineDetail[],
  ): Promise<void> {
    for (const detail of details) {
      const currentReturned = parseScaled(detail.deliveryLine.returnedQuantity, QUANTITY_SCALE);
      const newReturned = currentReturned + detail.quantityHundredths;

      await manager.getRepository(SalesDeliveryLineEntity).update(
        { tenantId, id: detail.deliveryLine.id },
        { returnedQuantity: minorToDecimal(newReturned) },
      );
    }
  }

  /**
   * Updates the return invoice with posting meta (stock value and COGS reversal).
   */
  private async updateReturnInvoicePostingMeta(
    tenantId: string,
    manager: EntityManager,
    returnInvoice: InvoiceEntity,
    details: ReturnLineDetail[],
    totalCogsReversalMinor: bigint,
  ): Promise<void> {
    const stockLines = details.map((detail) => ({
      sku: detail.deliveryLine.sku,
      quantity: Number(detail.quantityHundredths) / 100,
      unitCost: Number(minorToDecimal(detail.unitCostMinor)),
      value: Number(minorToDecimal(detail.lineCostMinor)),
      moved: 'IN' as const,
      warehouseId: returnInvoice.warehouseId,
    }));

    const stockValue = details.reduce(
      (sum, d) => sum + Number(minorToDecimal(d.lineCostMinor)),
      0,
    );

    const receivableMinor = toMinor(returnInvoice.finalPayable);
    const vatMinor = toMinor(returnInvoice.totalTax);
    const netMinor = receivableMinor - vatMinor;
    const stockMinor = -totalCogsReversalMinor; // positive for stock IN

    const postingMeta = {
      stockValue,
      lines: stockLines,
      posted: {
        receivable: (-receivableMinor).toString(),
        vat: (-vatMinor).toString(),
        net: (-netMinor).toString(),
        stock: stockMinor.toString(),
      },
    };

    await manager.getRepository(InvoiceEntity).update(
      { tenantId, id: returnInvoice.id },
      { postingMeta },
    );
  }

  /**
   * Posts the RETURN invoice voucher (revenue/VAT reversal) synchronously.
   * Returns the journal entry ID.
   */
  private async postReturnInvoiceVoucher(
    tenantId: string,
    manager: EntityManager,
    returnInvoice: InvoiceEntity,
    totals: { totalAmount: number; totalDiscount: number; totalTax: number; finalPayable: number },
    returnDate: string,
  ): Promise<number> {
    const receivableMinor = toMinor(totals.finalPayable);
    const vatMinor = toMinor(totals.totalTax);
    const netMinor = receivableMinor - vatMinor;
    const stockMinor = 0n; // Stock movement is handled separately via COGS reversal

    // For RETURN, reverse all amounts
    const amounts: PostedAmounts = {
      receivable: -receivableMinor,
      vat: -vatMinor,
      net: -netMinor,
      stock: -stockMinor,
    };

    // Build amounts for the invoice.sale.issue template with reverse=true
    const docType = documentDocType(true, true); // sale, reverse = 'invoice.sale.cancel'
    // But for RETURN we use the same template as issue but with reversed amounts
    // Actually the template is the same, just amounts are negative

    const signedRows = documentRows(true, {
      receivable: receivableMinor,
      vat: vatMinor,
      net: netMinor,
      stock: stockMinor,
    }, true); // reverse = true

    const templateAmounts = drCrAmounts(signedRows);

    // Get account overrides for invoice.sale.issue (same as RETURN)
    const described = await this.postingRules.describe(tenantId);
    const issueTemplate = described.find((d) => d.docType === 'invoice.sale.issue');
    const overrides: Partial<Record<PostingRole, string>> = {};
    if (issueTemplate) {
      for (const role of issueTemplate.roles) {
        if (role.accountCode) {
          overrides[role.role as PostingRole] = role.accountCode;
        }
      }
    }

    const result = await this.postingRules.post(
      tenantId,
      {
        docType: 'invoice.sale.issue', // Use issue template with reversed amounts
        sourceType: 'invoice',
        sourceId: returnInvoice.id,
        date: returnDate,
        amounts: templateAmounts,
        description: `برگشت صورتحساب ${returnInvoice.taxInvoiceNumber}`,
        entryNumber: `INV-${returnInvoice.id}-ISSUED`.slice(0, 64),
        overrides,
      },
      manager,
    );

    return result.entryId;
  }

  /**
   * Converts an InvoiceEntity to ReturnResponseDto.
   */
  private toResponseDto(invoice: InvoiceEntity): ReturnResponseDto {
    const items: ReturnLineResponseDto[] = [];

    if (invoice.items) {
      for (const item of invoice.items) {
        items.push({
          deliveryLineId: item.originalLine ? item.originalLine + 1 : 0,
          quantity: item.quantity,
          unitCost: item.unitPrice,
          value: item.total,
        });
      }
    }

    return {
      id: invoice.id,
      taxInvoiceNumber: invoice.taxInvoiceNumber,
      relatedInvoiceId: invoice.relatedInvoiceId ?? '',
      items,
      finalPayable: invoice.finalPayable,
      status: invoice.status,
    };
  }
}