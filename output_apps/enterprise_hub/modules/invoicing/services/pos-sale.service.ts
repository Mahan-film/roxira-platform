import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { createHash } from 'crypto';
import { CustomerIdentityService } from '../../crm/services/customer-identity.service';
import { Currency } from '../../currency/enums/currency.enum';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import {
  CreatePosSaleDto,
  PosConflictDto,
  PosSaleResponseDto,
  PosSyncedItemDto,
  PosSyncResultDto,
  SyncPosSalesDto,
} from '../dto/pos-sale.dto';
import { InvoiceDirection, InvoiceSubject } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { InvoicingRepository } from '../repositories/invoicing.repository';
import { InvoicingService } from './invoicing.service';
import { planReturnLines, splitRefund } from './pos-return.plan';

const UNIQUE_VIOLATION = '23505';

/**
 * One sale flow for the manual quick-sale form and a future POS API: customer (none, phone, or
 * name and phone), items by code or barcode, payments, and posting through the normal invoice
 * events (revenue, tax, cash/bank/POS clearing, COGS and stock). The idempotency key makes a retry
 * return the first invoice instead of posting again. With `returnOf` the same call records a return
 * of an earlier sale (a RETURN-subject invoice linked to it), see `createReturn`.
 */
@Injectable()
export class PosSaleService {
  constructor(
    private readonly invoicing: InvoicingService,
    private readonly invoicingRepository: InvoicingRepository,
    private readonly inventoryRepository: InventoryRepository,
    private readonly customerIdentity: CustomerIdentityService,
    private readonly tenantsRepository: TenantsRepository,
  ) {}

  /** Hash of what the sale means, so the same key cannot be reused for a different sale. */
  private hashOf(dto: CreatePosSaleDto): string {
    const { idempotencyKey: _key, ...body } = dto;
    return createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }

  private async replay(
    tenantId: string,
    key: string,
    hash: string,
  ): Promise<PosSaleResponseDto | null> {
    const existing = await this.invoicingRepository.findByIdempotencyKey(tenantId, key);
    if (!existing) {
      return null;
    }
    if (existing.requestHash !== hash) {
      throw new ConflictException(
        'این کلید یکتا قبلاً برای فروش دیگری استفاده شده است.',
      );
    }
    return {
      invoice: await this.invoicing.findOne(tenantId, existing.id),
      replayed: true,
      customerLevel: existing.customerId ? 'phone' : 'anonymous',
      customerCreated: false,
    };
  }

  async createSale(tenantId: string, dto: CreatePosSaleDto): Promise<PosSaleResponseDto> {
    const hash = this.hashOf(dto);
    const replayed = await this.replay(tenantId, dto.idempotencyKey, hash);
    if (replayed) {
      return replayed;
    }
    if (dto.returnOf) {
      return this.createReturn(tenantId, dto, hash);
    }
    const payments = dto.payments ?? [];
    if (payments.length === 0) {
      throw new BadRequestException('فروش دست‌کم یک پرداخت دارد.');
    }

    const tenant = await this.tenantsRepository.findById(tenantId);
    const lines = await this.resolveLines(tenantId, dto);
    await this.assertStock(tenantId, lines, dto.warehouseId ?? null);

    const quote = await this.invoicing.quote(tenantId, {
      items: lines,
      currency: dto.currency,
      fxRate: dto.fxRate,
      invoiceDiscount: dto.invoiceDiscount,
      invoiceDiscountPercent: dto.invoiceDiscountPercent,
    });
    this.assertPaid(quote.totals.finalPayable, payments, quote.currency);

    const identity = await this.customerIdentity.resolve(
      tenantId,
      dto.customer,
      tenant?.countryCode ?? 'IR',
    );
    const invoiceDto: CreateInvoiceDto = {
      sellerInfo: { name: tenant?.name ?? 'سازمان من' },
      items: lines,
      invoiceDiscount: dto.invoiceDiscount,
      invoiceDiscountPercent: dto.invoiceDiscountPercent,
      status: InvoiceStatus.PAID,
      currency: dto.currency,
      fxRate: dto.fxRate,
      warehouseId: dto.warehouseId,
      // Anonymous sales name no customer: the invoice service attaches the walk-in customer and
      // picks the country's anonymous type. A known customer is passed by id.
      ...(identity.level === 'anonymous' ? {} : { customerId: identity.lead.id }),
    };

    return this.persist(tenantId, invoiceDto, dto.idempotencyKey, hash, payments, identity);
  }

  /** Creates the invoice under the idempotency key; a concurrent retry that won the key is replayed. */
  private async persist(
    tenantId: string,
    invoiceDto: CreateInvoiceDto,
    key: string,
    hash: string,
    payments: Array<{ method: string; amount: number }>,
    identity: { level: PosSaleResponseDto['customerLevel']; created: boolean },
    deferEvents?: Array<() => Promise<void>>,
  ): Promise<PosSaleResponseDto> {
    try {
      const invoice = await this.invoicing.create(tenantId, invoiceDto, {
        idempotencyKey: key,
        requestHash: hash,
        deferEvents,
        payments: payments.length > 0 ? payments.map((p) => ({ method: p.method, amount: p.amount })) : undefined,
      });
      return {
        invoice,
        replayed: false,
        customerLevel: identity.level,
        customerCreated: identity.created,
      };
    } catch (error) {
      // A concurrent retry with the same key won the unique index: return its invoice.
      if ((error as { code?: string })?.code === UNIQUE_VIOLATION) {
        const winner = await this.replay(tenantId, key, hash);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  /**
   * A return of some or all lines of an earlier sale. The lines name the sale's line and the
   * quantity; price, VAT rate and a proportional share of the discount come from the sale, and
   * the quantity left to return counts every earlier return. Posting (RETURN subject) mirrors
   * revenue and VAT, and takes the goods back into the sale's warehouse at the cost the sale
   * recorded. ORIGINAL refunds over the sale's payment methods; CREDIT leaves the amount on the
   * customer's receivable account (not for the walk-in customer).
   */
  private async createReturn(
    tenantId: string,
    dto: CreatePosSaleDto,
    hash: string,
  ): Promise<PosSaleResponseDto> {
    const returnOf = dto.returnOf!;
    const sale = await this.invoicingRepository.findById(tenantId, returnOf.invoiceId);
    if (!sale) {
      throw new NotFoundException('فروش اصلی یافت نشد.');
    }
    if (
      (sale.direction ?? InvoiceDirection.SALE) !== InvoiceDirection.SALE ||
      (sale.subject ?? InvoiceSubject.ORIGINAL) !== InvoiceSubject.ORIGINAL ||
      (sale.status !== InvoiceStatus.ISSUED && sale.status !== InvoiceStatus.PAID)
    ) {
      throw new BadRequestException('فقط فروش اصلیِ صادرشده و ابطال‌نشده برگشت می‌خورد.');
    }
    if (dto.payments?.length) {
      throw new BadRequestException('در برگشت، روش بازپرداخت از فروش اصلی یا اعتبار مشتری می‌آید؛ payments نفرستید.');
    }
    if (returnOf.refund === 'ORIGINAL' && sale.status !== InvoiceStatus.PAID) {
      throw new BadRequestException('این فروش تسویه نشده است؛ برگشت را به اعتبار مشتری ثبت کنید.');
    }
    const walkIn = await this.customerIdentity.walkIn(tenantId);
    const known = sale.customerId !== null && sale.customerId !== undefined && sale.customerId !== walkIn.id;
    if (returnOf.refund === 'CREDIT' && !known) {
      throw new BadRequestException('مشتری گذری حساب اعتباری ندارد؛ بازپرداخت را به روش پرداخت فروش انجام دهید.');
    }
    if (dto.lines.some((line) => line.originalLine === undefined)) {
      throw new BadRequestException('هر سطر برگشت شمارهٔ سطر فروش اصلی (originalLine) را دارد.');
    }

    // Under the sale's lock: what is left to return is read after any concurrent return committed.
    return this.invoicing.withSaleLock(tenantId, sale.id, async (deferEvents) => {
      const earlier = (await this.invoicingRepository.findByRelated(tenantId, sale.id)).filter(
        (doc) => doc.subject === InvoiceSubject.RETURN && doc.status !== InvoiceStatus.CANCELLED,
      );
      const items = planReturnLines(
        sale.items,
        earlier.map((doc) => doc.items),
        dto.lines.map((line) => ({ originalLine: line.originalLine!, quantity: line.quantity })),
        sale.currency,
      );
      const fxRate = Number(sale.fxRate);
      const quote = await this.invoicing.quote(tenantId, {
        items,
        currency: sale.currency,
        jurisdiction: sale.jurisdiction,
        fxRate,
      });
      const refunds =
        returnOf.refund === 'ORIGINAL'
          ? splitRefund(quote.totals.finalPayable, sale.payments, sale.currency)
          : [];

      const invoiceDto: CreateInvoiceDto = {
        subject: InvoiceSubject.RETURN,
        relatedInvoiceId: sale.id,
        direction: InvoiceDirection.SALE,
        einvoiceType: sale.einvoiceType,
        sellerInfo: sale.sellerInfo,
        // The same buyer as on the sale (Moadian matches a return to its sale by the parties too).
        buyerInfo: sale.buyerInfo,
        ...(sale.customerId !== null && sale.customerId !== undefined ? { customerId: sale.customerId } : {}),
        currency: sale.currency,
        jurisdiction: sale.jurisdiction,
        fxRate,
        warehouseId: sale.warehouseId ?? undefined,
        items,
        // Refunded now: issued and settled at once. On credit: issued only, the receivable stays credited.
        status: returnOf.refund === 'ORIGINAL' ? InvoiceStatus.PAID : InvoiceStatus.ISSUED,
      };
      return this.persist(
        tenantId,
        invoiceDto,
        dto.idempotencyKey,
        hash,
        refunds,
        { level: known ? 'phone' : 'anonymous', created: false },
        deferEvents,
      );
    });
  }

  /** Lines with codes/barcodes resolved to stock items; a code that matches nothing is a 404. */
  private async resolveLines(
    tenantId: string,
    dto: CreatePosSaleDto,
  ): Promise<NonNullable<CreateInvoiceDto['items']>> {
    const lines: NonNullable<CreateInvoiceDto['items']> = [];
    for (const line of dto.lines) {
      const unitPrice = line.unitPrice;
      if (unitPrice === undefined || line.originalLine !== undefined) {
        throw new BadRequestException('هر سطر فروش قیمت واحد دارد و شمارهٔ سطر برگشت ندارد.');
      }
      const code = line.code?.trim();
      if (!code) {
        if (!line.description?.trim()) {
          throw new BadRequestException('هر سطر کد/بارکد کالا یا شرح دارد.');
        }
        lines.push({
          description: line.description.trim(),
          quantity: line.quantity,
          unitPrice,
          discount: line.discount,
          discountPercent: line.discountPercent,
          vatRate: line.vatRate,
        });
        continue;
      }
      const item = await this.inventoryRepository.findStockItemByCode(tenantId, code);
      if (!item) {
        throw new NotFoundException(`کالایی با کد یا بارکد ${code} یافت نشد.`);
      }
      lines.push({
        itemId: item.id,
        sku: item.sku,
        description: line.description?.trim() || item.name,
        quantity: line.quantity,
        unitPrice,
        discount: line.discount,
        discountPercent: line.discountPercent,
        vatRate: line.vatRate,
      });
    }
    return lines;
  }

  /** The sale cannot take more of an item than is on the shelf (posting would fail later otherwise). */
  private async assertStock(
    tenantId: string,
    lines: NonNullable<CreateInvoiceDto['items']>,
    warehouseId: number | null,
  ): Promise<void> {
    const wanted = new Map<string, number>();
    for (const line of lines) {
      if (line.sku) {
        wanted.set(line.sku, (wanted.get(line.sku) ?? 0) + line.quantity);
      }
    }
    for (const [sku, quantity] of wanted) {
      const available = await this.inventoryRepository.availableQuantity(tenantId, sku, warehouseId);
      if (quantity > available + 1e-9) {
        throw new BadRequestException(
          `موجودی کالای ${sku} کافی نیست. درخواستی: ${quantity}، موجود: ${available}.`,
        );
      }
    }
  }

  /** Payments must add up to the payable (whole rials for IRR, cents otherwise). */
  private assertPaid(payable: number, payments: Array<{ amount: number }>, currency: Currency): void {
    const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const tolerance = currency === Currency.IRR ? 0 : 0.005;
    if (Math.abs(paid - payable) > tolerance) {
      throw new BadRequestException(
        `جمع پرداخت‌ها (${paid}) با مبلغ قابل پرداخت (${payable}) برابر نیست.`,
      );
    }
  }

  /**
   * Synchronises an array of queued counter sales submitted from an offline POS client (#782 / T93).
   * Processes each sale under its client UUID idempotency key:
   * - If already processed: replays existing invoice without duplication.
   * - If inventory stock is insufficient: catches and records structured conflict item.
   * - If valid: posts invoice, payments, and stock/voucher movements.
   * Returns a comprehensive sync summary containing synced sales and conflicts for out-of-stock items.
   */
  async syncSales(tenantId: string, dto: SyncPosSalesDto): Promise<PosSyncResultDto> {
    const synced: PosSyncedItemDto[] = [];
    const conflicts: PosConflictDto[] = [];

    for (const rawSale of dto.sales) {
      const clientUuid =
        typeof (rawSale as { idempotencyKey?: unknown })?.idempotencyKey === 'string' &&
        (rawSale as { idempotencyKey: string }).idempotencyKey.trim()
          ? (rawSale as { idempotencyKey: string }).idempotencyKey
          : 'unknown';

      const saleDto = plainToInstance(CreatePosSaleDto, rawSale, {
        enableImplicitConversion: true,
      });
      const validationErrors = await validate(saleDto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      if (validationErrors.length > 0) {
        conflicts.push({
          clientUuid,
          code: 'VALIDATION_FAILED',
          error: this.formatValidationErrors(validationErrors),
        });
        continue;
      }

      try {
        const result = await this.createSale(tenantId, saleDto);
        synced.push({
          clientUuid,
          invoice: result.invoice,
          replayed: result.replayed,
        });
      } catch (error: unknown) {
        const status =
          error instanceof HttpException
            ? error.getStatus()
            : typeof (error as { status?: unknown })?.status === 'number'
              ? (error as { status: number }).status
              : undefined;
        const isBusinessRejection =
          error instanceof BadRequestException ||
          error instanceof NotFoundException ||
          error instanceof ConflictException ||
          status === 400 ||
          status === 404 ||
          status === 409;

        // Transient DB/network errors (5xx) and auth errors (401/403) must fail the batch
        // so the client sync coordinator can isolate and probe deterministically failing items.
        if (!isBusinessRejection) {
          throw error;
        }

        const message =
          error instanceof Error && error.message ? error.message : 'خطا در ثبت فروش';
        const isNotFound = error instanceof NotFoundException || status === 404;
        const isOutOfStock =
          !isNotFound &&
          (message.includes('موجودی') || message.includes('کافی نیست'));
        const isIdempotencyConflict = error instanceof ConflictException || status === 409;

        const code: PosConflictDto['code'] = isOutOfStock
          ? 'OUT_OF_STOCK'
          : isNotFound
            ? 'ITEM_NOT_FOUND'
            : isIdempotencyConflict
              ? 'CONFLICT'
              : 'VALIDATION_FAILED';

        const missingItems =
          isOutOfStock || isNotFound
            ? this.extractFailingSkus(message, saleDto)
            : undefined;

        conflicts.push({
          clientUuid,
          code,
          error: message,
          ...(missingItems && missingItems.length > 0 ? { missingItems } : {}),
        });
      }
    }

    return {
      synced,
      conflicts,
      totalProcessed: dto.sales.length,
    };
  }

  private extractFailingSkus(message: string, sale: CreatePosSaleDto): string[] {
    const stockMatch = message.match(/موجودی کالای\s+(\S+)\s+کافی نیست/);
    if (stockMatch?.[1]) {
      return [stockMatch[1]];
    }
    const missingMatch = message.match(/کد یا بارکد\s+(\S+)\s+یافت نشد/);
    if (missingMatch?.[1]) {
      return [missingMatch[1]];
    }
    return [];
  }

  private formatValidationErrors(errors: ValidationError[]): string {
    const messages: string[] = [];
    const visit = (err: ValidationError): void => {
      if (err.constraints) {
        messages.push(...Object.values(err.constraints));
      }
      if (err.children) {
        err.children.forEach(visit);
      }
    };
    errors.forEach(visit);
    return messages.length > 0 ? messages.join(' | ') : 'داده‌های فروش نامعتبر است.';
  }
}
