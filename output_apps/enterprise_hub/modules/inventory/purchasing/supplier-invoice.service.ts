import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { mergeRoleAccounts } from '../../invoicing/services/invoice-voucher';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { TenantScope } from '../../access/services/tenant-scope';
import { AccessService } from '../../access/services/access.service';
import { AuditService } from '../../access/services/audit.service';
import { PolicyService } from '../../tenants/policy/policy.service';
import { StockDocumentsService } from '../services/stock-documents.service';
import { invoicePostingTotals, matchInvoice, matchInvoiceLine } from './invoice-match.domain';
import { PurchaseAccountRole, resolvePurchaseRole } from './purchase-posting.adapter';
import { PurchaseOrder, PurchaseOrderStatus } from './purchase.types';
import { PurchaseRepository } from './purchase.repository';
import {
  NewSupplierInvoiceLine,
  SupplierInvoice,
  SupplierInvoiceRepository,
} from './supplier-invoice.repository';
import {
  AcceptSupplierInvoiceDto,
  CreateSupplierInvoiceDto,
  SupplierInvoiceResponseDto,
} from './supplier-invoice.dto';

const NOT_FOUND_ORDER = 'سفارش خرید یافت نشد.';
const NOT_FOUND_INVOICE = 'صورتحساب خرید یافت نشد.';
const DUPLICATE_REF = 'شماره صورتحساب تأمین‌کننده قبلاً در این سازمان ثبت شده است.';

/** Posting engine document type and source of a supplier-invoice voucher (one per invoice id). */
export const INVOICE_DOC_TYPE = 'purchase.invoice';
export const INVOICE_SOURCE_TYPE = 'supplier_invoice';

const INVOICEABLE_ORDER_STATUSES: ReadonlySet<PurchaseOrderStatus> = new Set([
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
  PurchaseOrderStatus.RECEIVED,
  PurchaseOrderStatus.CLOSED,
]);

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; driverError?: { code?: string } } | null;
  return candidate?.code === '23505' || candidate?.driverError?.code === '23505';
}

function toInvoiceResponse(invoice: SupplierInvoice): SupplierInvoiceResponseDto {
  return {
    id: invoice.id,
    tenantId: invoice.tenantId,
    number: invoice.number,
    orderId: invoice.orderId,
    supplierCode: invoice.supplierCode,
    supplierRef: invoice.supplierRef,
    invoiceDate: invoice.invoiceDate,
    status: invoice.status,
    accepted: invoice.accepted,
    acceptedBy: invoice.acceptedBy,
    acceptedAt: invoice.acceptedAt,
    acceptNote: invoice.acceptNote,
    createdBy: invoice.createdBy,
    acceptedByCreator: invoice.accepted === true && invoice.acceptedBy === invoice.createdBy,
    vat: invoice.vat.toString(),
    subtotal: invoice.subtotal.toString(),
    total: invoice.total.toString(),
    journalEntryId: invoice.journalEntryId,
    createdAt: invoice.createdAt,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      receiptLineId: line.receiptLineId,
      sku: line.sku,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toString(),
      orderValue: line.orderValue.toString(),
      invoiceValue: line.invoiceValue.toString(),
      priceDifference: line.priceDifference.toString(),
      matchStatus: line.matchStatus,
    })),
  };
}

/**
 * Supplier invoice and 3-way match (#227 T2). The pure rules live in `invoice-match.domain.ts`; this
 * service loads receipts and settings, decides HELD/MATCHED, stores the invoice and posts its voucher
 * through PostingRulesService (template `purchase.invoice`).
 */
@Injectable()
export class SupplierInvoiceService {
  constructor(
    private readonly scope: TenantScope,
    private readonly purchases: PurchaseRepository,
    private readonly invoices: SupplierInvoiceRepository,
    private readonly stockDocuments: StockDocumentsService,
    private readonly postingRules: PostingRulesService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  // --------------------------------------------------------------- invoices

  async createInvoice(
    tenantId: string,
    userId: string,
    orderId: string,
    dto: CreateSupplierInvoiceDto,
  ): Promise<SupplierInvoiceResponseDto> {
    return this.scope.run(tenantId, async (manager) => {
      const order = await this.purchases.findOrder(tenantId, orderId, manager, true);
      if (!order) throw new NotFoundException(NOT_FOUND_ORDER);
      if (!INVOICEABLE_ORDER_STATUSES.has(order.status)) {
        throw new ConflictException(
          `سفارش ${order.number} در وضعیت ${order.status} قابل صورتحساب نیست.`,
        );
      }

      const settings = await this.purchases.getSettings(tenantId, manager);
      const qtyExcessToleranceBp = Number(
        await this.policy.get(tenantId, 'purchase.three_way.qty_excess_tolerance_bp', manager),
      );
      const supplierRef = dto.supplierRef.trim();
      const existing = await this.invoices.findIdBySupplierRef(
        tenantId,
        order.supplierCode,
        supplierRef,
        manager,
      );
      if (existing) throw new ConflictException(DUPLICATE_REF);

      const matched: NewSupplierInvoiceLine[] = [];
      const seen = new Set<string>();
      for (const line of dto.lines) {
        if (seen.has(line.receiptLineId)) {
          throw new BadRequestException(
            `سطر رسید ${line.receiptLineId} در صورتحساب تکرار شده است.`,
          );
        }
        seen.add(line.receiptLineId);

        const receiptLine = await this.purchases.findReceiptLineForInvoice(
          tenantId,
          line.receiptLineId,
          manager,
        );
        if (!receiptLine || receiptLine.orderId !== order.id) {
          throw new BadRequestException(
            `سطر رسید ${line.receiptLineId} به سفارش ${order.number} تعلق ندارد.`,
          );
        }

        const quantity = BigInt(line.quantity);
        const unitPrice = BigInt(line.unitPrice);
        if (quantity <= 0n) {
          throw new BadRequestException('مقدار هر سطر صورتحساب باید مثبت باشد.');
        }
        const alreadyInvoicedQuantity = await this.invoices.sumInvoicedQuantity(
          tenantId,
          receiptLine.receiptLineId,
          manager,
        );
        const result = matchInvoiceLine(
          {
            orderUnitPrice: receiptLine.orderUnitPrice,
            receivedQuantity: receiptLine.receivedQuantity,
            alreadyInvoicedQuantity,
            quantity,
            unitPrice,
          },
          { ...settings, qtyExcessToleranceBp },
        );
        matched.push({
          receiptLineId: receiptLine.receiptLineId,
          sku: receiptLine.sku,
          quantity,
          unitPrice,
          orderValue: result.orderValue,
          invoiceValue: result.invoiceValue,
          priceDifference: result.priceDifference,
          matchStatus: result.status,
        });
      }

      const status = matchInvoice(matched.map((line) => ({ status: line.matchStatus })));
      const vat = dto.vat === undefined ? 0n : BigInt(dto.vat);
      const subtotal = matched.reduce((sum, line) => sum + line.invoiceValue, 0n);
      const totals = invoicePostingTotals(matched, vat);
      const number = await this.purchases.nextNumber(tenantId, 'SI', manager);

      try {
        const invoice = await this.invoices.insertInvoice(
          tenantId,
          {
            number,
            orderId: order.id,
            supplierCode: order.supplierCode,
            supplierRef,
            invoiceDate: dto.invoiceDate,
            status,
            createdBy: userId,
            vat,
            subtotal,
            total: totals.payable,
          },
          matched.map((line) => ({
            receiptLineId: line.receiptLineId,
            sku: line.sku,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            orderValue: line.orderValue,
            invoiceValue: line.invoiceValue,
            priceDifference: line.priceDifference,
            matchStatus: line.matchStatus,
          })),
          manager,
        );
        return toInvoiceResponse(invoice);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE_REF);
        throw error;
      }
    });
  }

  async listInvoices(tenantId: string): Promise<SupplierInvoiceResponseDto[]> {
    return this.scope.run(tenantId, async (manager) => {
      const invoices = await this.invoices.listInvoices(tenantId, manager);
      return invoices.map(toInvoiceResponse);
    });
  }

  async getInvoice(tenantId: string, id: string): Promise<SupplierInvoiceResponseDto> {
    return this.scope.run(tenantId, async (manager) => {
      const invoice = await this.invoices.findInvoice(tenantId, id, manager);
      if (!invoice) throw new NotFoundException(NOT_FOUND_INVOICE);
      return toInvoiceResponse(invoice);
    });
  }

  // ------------------------------------------------------- review and posting

  async acceptInvoice(
    tenantId: string,
    userId: string,
    id: string,
    dto: AcceptSupplierInvoiceDto,
  ): Promise<SupplierInvoiceResponseDto> {
    return this.scope.run(tenantId, async (manager) => {
      const invoice = await this.invoices.findInvoice(tenantId, id, manager, true);
      if (!invoice) throw new NotFoundException(NOT_FOUND_INVOICE);
      if (invoice.status !== 'HELD') {
        throw new ConflictException('فقط صورتحساب معلق (HELD) قابل تأیید است.');
      }
      const note = dto.note.trim();
      let creatorAccept: { rule: string; otherApprovers: number } | null = null;
      if (invoice.createdBy === userId) {
        const rule = String(
          await this.policy.get(tenantId, 'purchase.invoice_review.reviewer_rule', manager),
        );
        if (rule === 'always_differs') {
          throw new ForbiddenException('reviewer must differ from the creator');
        }
        const otherApprovers = await this.access.countEligibleApprovers(
          tenantId,
          userId,
          'inventory:approve',
        );
        if (rule === 'differs_unless_sole_approver' && otherApprovers > 0) {
          throw new ForbiddenException('reviewer must differ from the creator');
        }
        creatorAccept = { rule, otherApprovers };
      }
      if (note.length < 3) {
        throw new BadRequestException('یادداشت تأیید باید دست‌کم ۳ نویسه باشد.');
      }
      if (creatorAccept) {
        await this.audit.record(
          {
            tenantId,
            actorUserId: userId,
            action: 'purchase.invoice.accepted_by_creator',
            resourceType: 'supplier_invoice',
            resourceId: invoice.id,
            metadata: { rule: creatorAccept.rule, otherApprovers: creatorAccept.otherApprovers, note },
          },
          manager,
        );
      }

      const acceptedAt = new Date();
      await this.invoices.acceptInvoice(tenantId, invoice.id, userId, acceptedAt, note, manager);
      return toInvoiceResponse({
        ...invoice,
        status: 'MATCHED',
        accepted: true,
        acceptedBy: userId,
        acceptedAt,
        acceptNote: note,
      });
    });
  }

  async postInvoice(tenantId: string, id: string): Promise<SupplierInvoiceResponseDto> {
    return this.scope.run(tenantId, async (manager) => {
      const invoice = await this.invoices.findInvoice(tenantId, id, manager, true);
      if (!invoice) throw new NotFoundException(NOT_FOUND_INVOICE);
      if (invoice.status === 'HELD') throw new ConflictException('mismatch not accepted');
      if (invoice.status === 'POSTED') return toInvoiceResponse(invoice);

      const journalEntryId = await this.postVoucher(tenantId, invoice, manager);
      await this.invoices.markPosted(tenantId, invoice.id, journalEntryId, manager);
      return toInvoiceResponse({ ...invoice, status: 'POSTED', journalEntryId });
    });
  }

  /**
   * Posts GRNI debit, price-variance debit or credit, VAT debit and payable credit through the
   * posting engine. Accounts resolve by role like the goods receipt, and a tenant mapping wins.
   */
  private async postVoucher(
    tenantId: string,
    invoice: SupplierInvoice,
    manager: EntityManager,
  ): Promise<string> {
    const totals = invoicePostingTotals(invoice.lines, invoice.vat);
    const [grniCode, priceVarianceCode, payableCode, vatInputCode] =
      await this.stockDocuments.resolveAccounts(tenantId, [
        resolvePurchaseRole(PurchaseAccountRole.GRNI),
        resolvePurchaseRole(PurchaseAccountRole.PRICE_VARIANCE),
        resolvePurchaseRole(PurchaseAccountRole.PAYABLE),
        resolvePurchaseRole(PurchaseAccountRole.VAT_RECEIVABLE),
      ]);
    const described = (await this.postingRules.describe(tenantId)).find(
      (entry) => entry.docType === INVOICE_DOC_TYPE,
    );
    const overrides = mergeRoleAccounts(
      {
        grni: grniCode,
        price_variance: priceVarianceCode,
        payable: payableCode,
        vat_input: vatInputCode,
      },
      described,
    );

    const result = await this.postingRules.post(
      tenantId,
      {
        docType: INVOICE_DOC_TYPE,
        sourceType: INVOICE_SOURCE_TYPE,
        sourceId: invoice.id,
        date: `${invoice.invoiceDate}T00:00:00.000Z`,
        amounts: {
          grni: totals.grniDebit,
          variance_debit: totals.varianceNet > 0n ? totals.varianceNet : 0n,
          variance_credit: totals.varianceNet < 0n ? -totals.varianceNet : 0n,
          vat: totals.vat,
          payable: totals.payable,
        },
        description: `صورتحساب خرید ${invoice.number}`,
        partyCode: invoice.supplierCode,
        entryNumber: `PINV-${invoice.number}`,
        overrides,
      },
      manager,
    );
    return String(result.entryId);
  }
}