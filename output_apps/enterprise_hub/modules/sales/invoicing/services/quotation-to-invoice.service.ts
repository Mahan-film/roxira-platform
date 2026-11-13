import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { fromMinor, Money, parseMinor } from '../../../accounting/money';
import { Currency } from '../../../currency/enums/currency.enum';
import { tehranIsoDate } from '../../../hr/services/jalali-period';
import { CreateInvoiceDto } from '../../../invoicing/dto/create-invoice.dto';
import { InvoiceResponseDto } from '../../../invoicing/dto/invoice-response.dto';
import { InvoiceDirection } from '../../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../../invoicing/enums/invoice-status.enum';
import { InvoicingRepository } from '../../../invoicing/repositories/invoicing.repository';
import { InvoicingService } from '../../../invoicing/services/invoicing.service';
import { VatRateResolver } from '../../../invoicing/services/vat-rate.resolver';
import { PartiesService } from '../../../parties/services/parties.service';
import { TenantsRepository } from '../../../tenants/repositories/tenants.repository';
import { SalesQuotationLineEntity, SalesQuotationEntity } from '../../entities/sales-quotation.entity';
import {
  QUOTATION_INVOICE_CONVERTIBLE,
  SalesQuotationStatus,
} from '../../enums/sales-status.enum';
import { SalesRepository } from '../../repositories/sales.repository';
import {
  ConvertQuotationToInvoiceDto,
  ConvertQuotationToInvoiceResponseDto,
} from '../dto/quotation-to-invoice.dto';

const QUOTATION_NOT_FOUND = 'پیش‌فاکتور یافت نشد.';
const PARTY_NOT_FOUND = 'طرف‌حساب پیش‌فاکتور یافت نشد.';
const ALREADY_CONVERTED = 'پیش‌فاکتور قبلاً به صورتحساب تبدیل شده است.';
const QUOTATION_EXPIRED = 'پیش‌فاکتور منقضی شده است.';
const QUOTATION_REJECTED = 'پیش‌فاکتور رد شده قابل تبدیل به صورتحساب نیست.';
const QUOTATION_EMPTY = 'پیش‌فاکتور فاقد سطر است.';
const QUOTATION_NOT_CONVERTIBLE = 'وضعیت پیش‌فاکتور جهت تبدیل به صورتحساب مجاز نیست.';
const INVOICE_NOT_FOUND = 'صورتحساب تبدیل‌شده یافت نشد.';

function moneyOut(value: Money): Money {
  const text = typeof value === 'number' ? value.toFixed(2) : String(value);
  return fromMinor(parseMinor(text));
}

@Injectable()
export class QuotationToInvoiceService {
  constructor(
    private readonly salesRepository: SalesRepository,
    private readonly invoicingService: InvoicingService,
    private readonly invoicingRepository: InvoicingRepository,
    private readonly partiesService: PartiesService,
    @Optional() private readonly tenantsRepository?: TenantsRepository,
    @Optional() private readonly vatRateResolver?: VatRateResolver,
  ) {}

  /**
   * 1-Click conversion of a quotation into a sales invoice:
   * - Locks quotation FOR UPDATE inside TenantScope transaction.
   * - Checks idempotency: a quotation converts exactly once (409 Conflict on re-conversion).
   * - Checks expiry date: past `validUntil` sets status to EXPIRED and rejects with 400.
   * - Copies quotation lines into sales invoice items with statutory VAT rate.
   * - Sets quotation status to CONVERTED and saves `convertedInvoiceId`.
   */
  async convertQuotationToInvoice(
    tenantId: string,
    quotationId: number,
    dto?: ConvertQuotationToInvoiceDto,
    userId?: string,
  ): Promise<ConvertQuotationToInvoiceResponseDto> {
    return this.salesRepository.runInTransaction(tenantId, async (manager) => {
      const quotationRepo = manager.getRepository(SalesQuotationEntity);
      const quotationLineRepo = manager.getRepository(SalesQuotationLineEntity);

      // Lock quotation FOR UPDATE
      const quotation = await quotationRepo.findOne({
        where: { tenantId, id: quotationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!quotation) {
        throw new NotFoundException(QUOTATION_NOT_FOUND);
      }

      // Check if already converted (idempotency guard)
      if (
        quotation.status === SalesQuotationStatus.CONVERTED ||
        quotation.convertedInvoiceId !== null
      ) {
        if (dto?.idempotencyKey && quotation.convertedInvoiceId) {
          return this.replayConvertedInvoice(
            tenantId,
            quotation,
            quotation.convertedInvoiceId,
          );
        }
        throw new ConflictException(ALREADY_CONVERTED);
      }

      // Check terminal or invalid states
      if (quotation.status === SalesQuotationStatus.REJECTED) {
        throw new BadRequestException(QUOTATION_REJECTED);
      }
      if (quotation.status === SalesQuotationStatus.EXPIRED) {
        throw new BadRequestException(QUOTATION_EXPIRED);
      }
      if (!QUOTATION_INVOICE_CONVERTIBLE.includes(quotation.status)) {
        throw new ConflictException(QUOTATION_NOT_CONVERTIBLE);
      }

      // Check validity / expiry date
      const effectiveDate = dto?.invoiceDate ?? tehranIsoDate(new Date());
      if (quotation.validUntil && quotation.validUntil < effectiveDate) {
        await quotationRepo.update(
          { tenantId, id: quotationId },
          { status: SalesQuotationStatus.EXPIRED },
        );
        throw new BadRequestException(QUOTATION_EXPIRED);
      }

      // Load quotation lines
      const quotationLines = await quotationLineRepo.find({
        where: { tenantId, quotationId },
        order: { lineNo: 'ASC' },
      });

      if (quotationLines.length === 0) {
        throw new BadRequestException(QUOTATION_EMPTY);
      }

      // Lookup buyer party details
      const party = await this.partiesService.getByCode(tenantId, quotation.partyCode);
      if (!party) {
        throw new NotFoundException(PARTY_NOT_FOUND);
      }

      // Lookup seller organisation name
      const tenant = this.tenantsRepository
        ? await this.tenantsRepository.findById(tenantId)
        : null;
      const sellerName = tenant?.name?.trim() || 'سازمان من';

      // Resolve statutory VAT rate for effective date
      let vatRate = 0.1;
      if (this.vatRateResolver) {
        try {
          const resolved = await this.vatRateResolver.generalRate(tenantId, effectiveDate);
          vatRate = resolved.rate;
        } catch {
          vatRate = 0.1;
        }
      }

      // Prepare invoice items
      const invoiceItems = quotationLines.map((line) => ({
        itemId: line.itemId > 0 ? line.itemId : undefined,
        description: line.description?.trim() || `کالای ردیف ${line.lineNo}`,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        discount: Number(line.discount || 0),
        vatRate,
      }));

      // Create sales invoice
      const invoicePayload: CreateInvoiceDto = {
        taxInvoiceNumber: dto?.taxInvoiceNumber,
        direction: InvoiceDirection.SALE,
        status: dto?.status ?? InvoiceStatus.ISSUED,
        currency: Currency.IRR,
        sellerInfo: { name: sellerName },
        buyerInfo: {
          name: party.name,
          partyCode: quotation.partyCode,
          nationalId: party.nationalId || undefined,
          economicCode: party.economicCode || undefined,
          phone: party.phone || undefined,
          email: party.email || undefined,
        } as CreateInvoiceDto['buyerInfo'],
        items: invoiceItems,
        warehouseId: dto?.warehouseId ?? undefined,
      };

      const createdInvoice = await this.invoicingService.create(tenantId, invoicePayload, {
        idempotencyKey: dto?.idempotencyKey ? `QINV-${dto.idempotencyKey}` : undefined,
        manager,
        issuedAt: new Date(`${effectiveDate}T00:00:00+03:30`),
      });

      // Transition quotation status to CONVERTED and persist link
      await quotationRepo.update(
        { tenantId, id: quotationId },
        {
          status: SalesQuotationStatus.CONVERTED,
          convertedInvoiceId: createdInvoice.id,
        },
      );

      return {
        quotationId: quotation.id,
        quotationNumber: quotation.number,
        invoiceId: createdInvoice.id,
        taxInvoiceNumber: createdInvoice.taxInvoiceNumber,
        status: String(createdInvoice.status),
        partyCode: quotation.partyCode,
        invoiceDate: effectiveDate,
        totalAmount: moneyOut(createdInvoice.totalAmount),
        totalTax: moneyOut(createdInvoice.totalTax),
        finalPayable: moneyOut(createdInvoice.finalPayable),
        replayed: false,
        invoice: createdInvoice,
      };
    });
  }

  private async replayConvertedInvoice(
    tenantId: string,
    quotation: SalesQuotationEntity,
    invoiceId: string,
  ): Promise<ConvertQuotationToInvoiceResponseDto> {
    const invoice = await this.invoicingRepository.findById(tenantId, invoiceId);
    if (!invoice) {
      throw new NotFoundException(INVOICE_NOT_FOUND);
    }
    const invoiceDto = await this.invoicingService.findOne(tenantId, invoiceId);
    const invoiceDate = tehranIsoDate(invoice.issuedAt ?? invoice.createdAt);

    return {
      quotationId: quotation.id,
      quotationNumber: quotation.number,
      invoiceId: invoice.id,
      taxInvoiceNumber: invoice.taxInvoiceNumber,
      status: String(invoice.status),
      partyCode: quotation.partyCode,
      invoiceDate,
      totalAmount: moneyOut(invoice.totalAmount),
      totalTax: moneyOut(invoice.totalTax),
      finalPayable: moneyOut(invoice.finalPayable),
      replayed: true,
      invoice: invoiceDto,
    };
  }
}
