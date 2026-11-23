import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { EntityManager, IsNull } from 'typeorm';
import { fromMinor, Money, MoneyFormatError, parseMinor, toMinor } from '../../../accounting/money';
import { Currency } from '../../../currency/enums/currency.enum';
import { tehranDateOf, tehranDayWindow } from '../../../hr/services/tehran-time';
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

function moneyOut(value: unknown): Money {
  if (typeof value === 'bigint') return fromMinor(value);
  if (typeof value === 'number') {
    return Number.isFinite(value) ? fromMinor(toMinor(value)) : '0';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? fromMinor(toMinor(trimmed)) : '0';
  }
  return '0';
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
    const txResult = await this.salesRepository.runInTransaction(tenantId, async (manager) => {
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

        // Request fingerprint for idempotency check (Rule 18)
        const requestPayload = {
          quotationId,
          partyCode: quotation.partyCode,
          invoiceDate: dto?.invoiceDate ?? null,
          status: dto?.status ?? null,
          taxInvoiceNumber: dto?.taxInvoiceNumber ?? null,
          warehouseId: dto?.warehouseId ?? null,
        };
        const requestHash = crypto
          .createHash('sha256')
          .update(JSON.stringify(requestPayload))
          .digest('hex');

        // Check if already converted (idempotency guard)
        if (
          quotation.status === SalesQuotationStatus.CONVERTED ||
          quotation.convertedInvoiceId !== null
        ) {
          if (dto?.idempotencyKey && quotation.convertedInvoiceId) {
            const invoice = await this.invoicingRepository.findById(
              tenantId,
              quotation.convertedInvoiceId,
            );
            if (!invoice) {
              throw new NotFoundException(INVOICE_NOT_FOUND);
            }
            if (invoice.requestHash && invoice.requestHash !== requestHash) {
              throw new ConflictException(
                `Idempotency-Key "${dto.idempotencyKey}" was already used with a different conversion payload.`,
              );
            }
            return this.replayConvertedInvoice(
              tenantId,
              quotation,
              invoice,
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
          throw new BadRequestException(QUOTATION_NOT_CONVERTIBLE);
        }

        // Check validity / expiry date and bounds
        const today = tehranDateOf(new Date());
        const effectiveDate = dto?.invoiceDate ?? today;
        const quoteDateRaw = quotation.quoteDate as unknown;
        const validUntilRaw = quotation.validUntil as unknown;
        const quoteDateIso =
          quoteDateRaw instanceof Date
            ? tehranDateOf(quoteDateRaw)
            : String(quotation.quoteDate).slice(0, 10);
        const validUntilIso = quotation.validUntil
          ? validUntilRaw instanceof Date
            ? tehranDateOf(validUntilRaw)
            : String(quotation.validUntil).slice(0, 10)
          : null;

        if (effectiveDate < quoteDateIso) {
          throw new BadRequestException('تاریخ صدور صورتحساب نمی‌تواند قبل از تاریخ پیش‌فاکتور باشد.');
        }
        if (effectiveDate > today) {
          throw new BadRequestException('تاریخ صدور صورتحساب نمی‌تواند در آینده باشد.');
        }
        if (validUntilIso && validUntilIso < effectiveDate) {
          await quotationRepo.update(
            { tenantId, id: quotationId, convertedInvoiceId: IsNull() },
            { status: SalesQuotationStatus.EXPIRED },
          );
          return { expired: true as const };
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
      const sellerName = tenant?.name?.trim();
      if (!sellerName) {
        throw new BadRequestException('نام سازمان فروشنده ثبت نشده است.');
      }

      // Resolve statutory VAT rate for effective date (fails closed if unavailable)
      let vatRate: number;
      if (this.vatRateResolver) {
        try {
          const resolved = await this.vatRateResolver.generalRate(tenantId, effectiveDate);
          vatRate = resolved.rate;
        } catch (err) {
          throw new BadRequestException(
            `Failed to resolve statutory VAT rate for ${effectiveDate}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        throw new BadRequestException('سرویس محاسبه نرخ مالیات بر ارزش افزوده در دسترس نیست.');
      }

      // Prepare invoice items: quantity is a plain decimal, prices/discounts use exact minor units
      const invoiceItems = quotationLines.map((line) => {
        const rawQty = String(line.quantity ?? '').trim();
        const cleanQty = rawQty.startsWith('.') ? `0${rawQty}` : rawQty;
        const normalizedQty = cleanQty.includes('.') ? cleanQty.replace(/\.?0+$/, '') : cleanQty;
        if (!/^\d+(?:\.\d+)?$/.test(normalizedQty)) {
          throw new BadRequestException('مقدار سطر پیش‌فاکتور معتبر نیست.');
        }
        const qtyVal = Number(normalizedQty);
        if (!Number.isFinite(qtyVal) || qtyVal <= 0) {
          throw new BadRequestException('مقدار سطر پیش‌فاکتور معتبر نیست.');
        }
        const unitPriceMinor = toMinor(line.unitPrice);
        const discountMinor = line.discount ? toMinor(line.discount) : 0n;
        const unitPriceVal = fromMinor(unitPriceMinor);
        const discountVal = discountMinor > 0n ? fromMinor(discountMinor) : 0;
        // In modules/accounting/money.ts:90, fromMinor returns `number` for values within MAX_NUMBER_MINOR
        // (2^51 minor units, ~2.25 quadrillion Rials) and `string` (minorToDecimal) only if it overflows.
        // InvoiceItemDto requires `number` for unitPrice; if an amount overflows safe float representation,
        // we fail closed with BadRequestException rather than passing an unsafe string to the invoice service.
        if (typeof unitPriceVal === 'string' || typeof discountVal === 'string') {
          throw new BadRequestException(
            'مبلغ واحد یا تخفیف سطر بیش از حد مجاز برای صدور صورتحساب است.',
          );
        }
        return {
          itemId: line.itemId > 0 ? line.itemId : undefined,
          description: line.description?.trim() || `کالای ردیف ${line.lineNo}`,
          quantity: qtyVal,
          unitPrice: unitPriceVal,
          discount: discountVal,
          vatRate,
        };
      });

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

      const dayWindow = tehranDayWindow(effectiveDate);
      if (!dayWindow) {
        throw new BadRequestException('تاریخ صدور صورتحساب نامعتبر است.');
      }

      const createdInvoice = await this.invoicingService.create(tenantId, invoicePayload, {
        idempotencyKey: dto?.idempotencyKey ? `QINV-${dto.idempotencyKey}` : undefined,
        requestHash: dto?.idempotencyKey ? requestHash : undefined,
        manager,
        issuedAt: dayWindow.start,
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
        expired: false as const,
        response: {
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
        },
      };
    });
    if ('expired' in txResult && txResult.expired) {
      throw new BadRequestException(QUOTATION_EXPIRED);
    }
    return 'response' in txResult ? txResult.response : txResult;
  }

  private async replayConvertedInvoice(
    tenantId: string,
    quotation: SalesQuotationEntity,
    invoice: any,
  ): Promise<ConvertQuotationToInvoiceResponseDto> {
    const invoiceDto = await this.invoicingService.findOne(tenantId, invoice.id);
    const invoiceDate = tehranDateOf(invoice.issuedAt ?? invoice.createdAt);

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
