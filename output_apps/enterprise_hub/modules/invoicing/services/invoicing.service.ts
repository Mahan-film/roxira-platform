import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EntityManager, FindOptionsWhere, ILike } from 'typeorm';
import { fromMinor } from '../../accounting/money';
import { CustomerIdentityService, WALK_IN_NAME } from '../../crm/services/customer-identity.service';
import { invoiceRuleFor } from '../country/invoice-country-rules';
import { CrmRepository } from '../../crm/repositories/crm.repository';
import { BASE_CURRENCY } from '../../currency/constants/currency.constants';
import { Currency } from '../../currency/enums/currency.enum';
import { CurrencyService } from '../../currency/services/currency.service';
import {
  assertValidQuantityScale,
  QUANTITY_SCALE,
} from '../../inventory/constants/inventory.constants';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { PartiesService } from '../../parties/services/parties.service';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import {
  DEFAULT_TAX_INVOICE_NUMBER_PREFIX,
  INTL_DEFAULT_VAT_RATE,
  MONEY_SCALE,
  TOMAN_TO_RIAL,
} from '../constants/invoicing.constants';
import {
  SUITE_EVENT_INVOICE_STATUS_JOB,
  SUITE_EVENTS_QUEUE,
} from '../constants/suite-events.constants';
import {
  CreateInvoiceDto,
  InvoiceItemDto,
  InvoicePartyInfoDto,
} from '../dto/create-invoice.dto';
import { InvoiceResponseDto } from '../dto/invoice-response.dto';
import { QueryInvoiceDto } from '../dto/query-invoice.dto';
import { UpdateInvoiceDto } from '../dto/update-invoice.dto';
import {
  InvoiceEntity,
  InvoiceItem,
  InvoicePartyInfo,
} from '../entities/invoice.entity';
import { InvoiceJurisdiction } from '../enums/invoice-jurisdiction.enum';
import {
  EInvoiceType,
  InvoiceDirection,
  InvoiceSubject,
} from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import {
  InvoiceSummaryRow,
  InvoicingRepository,
} from '../repositories/invoicing.repository';
import { tehranIsoDate } from '../../hr/services/jalali-period';
import {
  groupInvoiceRows,
  InvoiceImportPlan,
  InvoiceImportRow,
  InvoiceImportRowResult,
  ImportedPartyRef,
} from './invoice-import';
import { VatRateResolver } from './vat-rate.resolver';
import { allocateDiscount, fromUnits, percentOf, toUnits } from './invoice-discount';
import {
  computeLineMath,
  LINE_PRICE_EXTRA_DECIMALS,
  LINE_QUANTITY_DECIMALS,
  LINE_RATE_DECIMALS,
  numberToScaled,
} from './invoice-line-math';

/** What a caller adds to `create` beyond the invoice itself (POS sales, invoices from deliveries). */
export interface CreateInvoiceOptions {
  idempotencyKey?: string;
  requestHash?: string;
  payments?: Array<{ method: string; amount: number }>;
  /**
   * Set by `withSaleLock`: the status event is queued here and sent after the lock is released
   * (posting locks the related sale itself, so it must not run while this caller holds it).
   */
  deferEvents?: Array<() => Promise<void>>;
  /**
   * Insert the invoice row with this manager instead of the repository's own connection, so a
   * caller's transaction (invoice from delivery lines, #563) commits the invoice together with
   * its own rows. Reads stay on the normal connections; only the insert joins the transaction.
   */
  manager?: EntityManager;
  /** Issue date of a backdated invoice (the VAT rate and posting date follow it). Defaults to now. */
  issuedAt?: Date;
}

/** Invoice-level discount as sent: an amount or a percent (E1.3). */
export interface InvoiceDiscountInput {
  amount?: number;
  percent?: number;
}

interface PreparedLine {
  item: InvoiceItemDto;
  itemId: number | null;
  sku: string | null;
  description: string;
  gross: number;
  lineDiscount: number;
  taxCode?: string | null;
}

/** مجموع‌های محاسبه‌شده سمت سرور برای اقلام صورتحساب. */
interface InvoiceTotals {
  totalAmount: number;
  totalDiscount: number;
  totalTax: number;
  finalPayable: number;
}

/** ورودی درج یک صورتحساب از مسیر ورود بستهٔ دیتابیس. */
export interface InvoicingImportInput {
  rowNumber?: number;
  number: string;
  type?: string;
  date?: string;
  partyCode?: string;
  itemCode?: string;
  quantity?: number;
  unitPrice?: number;
  currency?: string;
  amount?: number;
  fxRate?: number;
  vat?: number;
  totalRial?: number;
}

/**
 * سرویس صورتحساب مالیاتی هوشمند (Smart Invoicing).
 *
 * تمام منطق کسب‌وکار (محاسبه مالیات ارزش افزوده هر سطر، جمع‌بندی مبالغ،
 * پیوند به مشتری CRM و کالای انبار، کنترل یکتایی شماره و گردش وضعیت) اینجا
 * قرار دارد؛ Controller فقط مسیریابی می‌کند و Repository فقط پرسیستنس انجام
 * می‌دهد (Rule #3 - AGENTS.md).
 */
@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    private readonly invoicingRepository: InvoicingRepository,
    private readonly currencyService: CurrencyService,
    @Optional() private readonly crmRepository?: CrmRepository,
    @Optional()
    private readonly inventoryRepository?: InventoryRepository,
    @Optional() private readonly tenantsRepository?: TenantsRepository,
    @Optional()
    @InjectQueue(SUITE_EVENTS_QUEUE)
    private readonly suiteEventsQueue?: Queue,
    @Optional() private readonly customerIdentity?: CustomerIdentityService,
    @Optional() vatRateResolver?: VatRateResolver,
    @Optional() private readonly partiesService?: PartiesService,
  ) {
    // Without the store (unit tests that build the service by hand) no general rate exists: an
    // invoice line without an explicit rate is refused (#126). Specs pass __fixtures__/vat-rate.fixture.
    this.vatRates = vatRateResolver ?? new VatRateResolver();
  }

  private readonly vatRates: VatRateResolver;

  /**
   * انتشار رویداد تغییر وضعیت صورتحساب در صف `suite-events` (Rule #5).
   * در نبود صف (محیط تست)، بی‌صدا نادیده گرفته می‌شود.
   */
  private async emitStatusEvent(
    tenantId: string,
    invoiceId: string,
    status: InvoiceStatus,
  ): Promise<void> {
    if (!this.suiteEventsQueue) {
      return;
    }
    try {
      await this.suiteEventsQueue.add(
        SUITE_EVENT_INVOICE_STATUS_JOB,
        { tenantId, invoiceId, status },
        { removeOnComplete: true, removeOnFail: true },
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue ${status} event for invoice ${invoiceId}: ${
          (error as Error).message
        }`,
      );
    }
  }

  /** گرد کردن مبالغ ریالی تا ۲ رقم اعشار. */
  private round(value: number): number {
    return this.roundTo(value, MONEY_SCALE);
  }

  private roundTo(value: number, scale: number): number {
    const factor = 10 ** scale;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  /** ریال کامل بدون اعشار؛ تومان تا یک رقم (یک ریال)؛ سایر ارزها دو رقم. */
  private moneyScale(currency: Currency): number {
    if (currency === Currency.IRR) {
      return 0;
    }
    if (currency === Currency.IRT) {
      return 1;
    }
    return MONEY_SCALE;
  }

  /**
   * نرمال‌سازی نرخ VAT: ورودی می‌تواند نسبت (۰٫۱) یا درصد (۱۰) باشد؛
   * خروجی همیشه نسبت در بازه ۰ تا ۱ است.
   */
  private normalizeVatRate(value: number | undefined, fallback: number | null): number {
    if (value === undefined || value === null) {
      if (fallback === null) {
        // defaultVatRateForJurisdiction returns null only when every line has its own rate.
        throw new BadRequestException('نرخ مالیات ارزش افزوده سطر مشخص نیست.');
      }
      return this.roundRate(fallback);
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException('نرخ مالیات ارزش افزوده نامعتبر است.');
    }
    const rate = value > 1 ? value / 100 : value;
    if (rate > 1) {
      throw new BadRequestException('نرخ مالیات ارزش افزوده نمی‌تواند بیش از ۱۰۰٪ باشد.');
    }
    return this.roundRate(rate);
  }

  private roundRate(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException('نرخ مالیات ارزش افزوده نامعتبر است.');
    }
    let rate = value > 1 ? value / 100 : value;
    if (rate > 1) rate = 1;
    // Six decimals: the same precision the statutory store accepts for rates (statutory-catalogue RATE).
    return Math.round((rate + Number.EPSILON) * 1_000_000) / 1_000_000;
  }

  /**
   * General VAT rate in force on the invoice date (see VatRateResolver): the statutory store by
   * date, an organisation's own row in the store first; refused when no row covers the date (#126).
   * Never a code value and never `tenants.default_vat_rate`.
   * The date is the Iran calendar day of `onDate` (Asia/Tehran), not the UTC day (#125).
   */
  private async resolveDefaultVatRate(tenantId: string, onDate: Date): Promise<number> {
    const { rate } = await this.vatRates.generalRate(tenantId, tehranIsoDate(onDate));
    return this.roundRate(rate);
  }

  /** آیا ارز داخلی (ریال/تومان) است؟ */
  private isIranianCurrency(currency: Currency): boolean {
    return currency === Currency.IRR || currency === Currency.IRT;
  }

  /** حوزه قضایی پیش‌فرض بر مبنای ارز: IRR/IRT داخلی، سایر ارزها بین‌المللی. */
  private defaultJurisdiction(currency: Currency): InvoiceJurisdiction {
    return this.isIranianCurrency(currency)
      ? InvoiceJurisdiction.IR
      : InvoiceJurisdiction.INTL;
  }

  /**
   * نرخ تبدیل ارز صورتحساب به ریال (`fx_rate`).
   * IRR = ۱ و IRT = ۱۰؛ برای سایر ارزها ورودی کاربر الزامی و باید عددی
   * متناهی و مثبت باشد.
   */
  private resolveFxRate(currency: Currency, requested?: number): number {
    if (currency === Currency.IRT) {
      return TOMAN_TO_RIAL;
    }
    if (currency === Currency.IRR) {
      return 1;
    }
    if (
      requested === undefined ||
      requested === null ||
      !Number.isFinite(requested) ||
      requested <= 0
    ) {
      throw new BadRequestException(
        'برای صورتحساب به ارز غیر از ریال/تومان، وارد کردن نرخ تبدیل به ریال (fxRate) الزامی است.',
      );
    }
    return requested;
  }

  /**
   * Default VAT rate by jurisdiction: INTL zero; IR the general rate on the invoice date.
   * `null` when every line carries its own rate: the store is then not read, so a date with no
   * store row does not refuse an invoice that never needs the general rate (#126).
   */
  private async defaultVatRateForJurisdiction(
    tenantId: string,
    jurisdiction: InvoiceJurisdiction,
    onDate: Date,
    items: InvoiceItemDto[],
  ): Promise<number | null> {
    if (jurisdiction === InvoiceJurisdiction.INTL) {
      return INTL_DEFAULT_VAT_RATE;
    }
    if (items.every((item) => item.vatRate !== undefined && item.vatRate !== null)) {
      return null;
    }
    return this.resolveDefaultVatRate(tenantId, onDate);
  }

  /**
   * تکمیل اطلاعات خریدار از سرنخ CRM (در صورت وجود `customerId`) و اعمال
   * مقادیر صریح DTO روی آن. پیوند مشتری همیشه با قید مستأجر خوانده می‌شود.
   */
  private async resolveBuyer(
    tenantId: string,
    customerId: number | undefined,
    buyerInfo?: InvoicePartyInfoDto,
  ): Promise<{ customerId: number | null; buyerInfo: InvoicePartyInfo }> {
    let derived: InvoicePartyInfo | null = null;

    if (customerId !== undefined && customerId !== null) {
      if (this.crmRepository) {
        const lead = await this.crmRepository.findLeadById(tenantId, customerId);
        if (!lead) {
          throw new NotFoundException(
            `مشتری با شناسه ${customerId} در سازمان شما یافت نشد.`,
          );
        }
        derived = {
          name: lead.company?.trim() || lead.fullName,
          phone: lead.phone ?? undefined,
          email: lead.email || undefined,
        };
      }
    }

    const merged = { ...(derived ?? {}), ...(buyerInfo ?? {}) } as InvoicePartyInfo;
    if (!merged.name || !String(merged.name).trim()) {
      if (customerId !== undefined && customerId !== null && !this.crmRepository) {
        merged.name = `مشتری #${customerId}`;
      } else {
        throw new BadRequestException(
          'نام خریدار الزامی است؛ یا customerId معتبر بفرستید یا buyerInfo.name را پر کنید.',
        );
      }
    }
    merged.name = String(merged.name).trim();

    return {
      customerId: customerId ?? null,
      buyerInfo: merged,
    };
  }

  /**
   * نرمال‌سازی و بازمحاسبه معتبر اقلام:
   *   gross    = quantity × unitPrice
   *   discount = line discount (amount or percent of gross) + share of the invoice discount
   *   taxable  = gross - discount  (VAT on the discounted base, E1.3)
   *   tax      = taxable × vatRate (نرخ ذخیره‌شده روی همان سطر)
   *   total    = taxable + tax
   */
  private async normalizeItems(
    tenantId: string,
    items: InvoiceItemDto[],
    defaultVatRate: number | null,
    currency: Currency = Currency.IRR,
    invoiceDiscount?: InvoiceDiscountInput,
  ): Promise<InvoiceItem[]> {
    const prepared: PreparedLine[] = [];
    const scale = this.moneyScale(currency);

    for (const item of items) {
      let itemId = item.itemId ?? null;
      let sku = item.sku?.trim() || null;
      let derivedDescription: string | undefined;
      let derivedSku: string | undefined;
      let derivedTaxCode: string | null = null;

      if (
        this.inventoryRepository &&
        (item.itemId !== undefined || item.sku)
      ) {
        const stockItem =
          item.itemId !== undefined
            ? await this.inventoryRepository.findStockItemById(
                tenantId,
                item.itemId,
              )
            : await this.inventoryRepository.findStockItemBySku(
                tenantId,
                item.sku as string,
              );

        if (!stockItem) {
          throw new NotFoundException(
            item.itemId !== undefined
              ? `کالای انبار با شناسه ${item.itemId} یافت نشد.`
              : `کالای انبار با SKU ${item.sku} یافت نشد.`,
          );
        }
        itemId = stockItem.id;
        derivedSku = stockItem.sku;
        derivedDescription = stockItem.name;
        derivedTaxCode = stockItem.taxCode ?? null;
      }

      if (derivedSku) {
        sku = derivedSku;
      }

      const description = (
        item.description ??
        derivedDescription ??
        sku ??
        (itemId !== null ? `کالای #${itemId}` : '')
      ).trim();
      if (!description) {
        throw new BadRequestException(
          'شرح هر سطر الزامی است؛ یا کالای انبار انتخاب کنید یا description بفرستید.',
        );
      }

      assertValidQuantityScale(
        item.quantity,
        QUANTITY_SCALE,
        `تعداد سطر «${description}»`,
      );

      prepared.push({
        item,
        itemId,
        sku,
        description,
        gross: item.quantity * item.unitPrice,
        lineDiscount: this.lineDiscount(item, scale),
        taxCode: item.taxCode ?? derivedTaxCode ?? null,
      });
    }

    const shares = this.invoiceDiscountShares(prepared, invoiceDiscount, scale);
    const normalized: InvoiceItem[] = [];
    prepared.forEach((line, index) => {
      const share = fromUnits(shares[index], scale);
      const discount = this.roundTo(line.lineDiscount + share, scale);
      const vatRate = this.normalizeVatRate(line.item.vatRate, defaultVatRate);
      const math = computeLineMath({
        quantity: numberToScaled(line.item.quantity, LINE_QUANTITY_DECIMALS),
        unitPrice: numberToScaled(line.item.unitPrice, scale + LINE_PRICE_EXTRA_DECIMALS),
        discount: toUnits(discount, scale),
        vatRate: numberToScaled(vatRate, LINE_RATE_DECIMALS),
      });
      const tax = fromUnits(math.tax, scale);
      const total = fromUnits(math.total, scale);

      normalized.push({
        itemId: line.itemId,
        sku: line.sku,
        description: line.description,
        quantity: line.item.quantity,
        unitPrice: this.roundTo(line.item.unitPrice, scale),
        discount,
        ...(invoiceDiscount ? { invoiceDiscountShare: share } : {}),
        vatRate,
        tax,
        total,
        ...(line.taxCode ? { taxCode: line.taxCode } : {}),
        ...(line.item.originalLine !== undefined ? { originalLine: line.item.originalLine } : {}),
      });
    });

    return normalized;
  }

  /** The line's own discount: an amount or a percent of quantity × unit price, never above it. */
  private lineDiscount(item: InvoiceItemDto, scale: number): number {
    const gross = item.quantity * item.unitPrice;
    const amount = item.discount ?? 0;
    const percent = item.discountPercent ?? 0;
    if (amount > 0 && percent > 0) {
      throw new BadRequestException('تخفیف سطر را یا به مبلغ یا به درصد وارد کنید، نه هر دو.');
    }
    const discount =
      percent > 0 ? fromUnits(percentOf(toUnits(gross, scale), percent), scale) : this.roundTo(amount, scale);
    if (discount > this.roundTo(gross, scale)) {
      throw new BadRequestException(
        `تخفیف سطر (${discount}) از مبلغ سطر (${this.roundTo(gross, scale)}) بیشتر است.`,
      );
    }
    return discount;
  }

  /**
   * The invoice discount in minor units, spread over the lines in proportion to their amount net
   * of their own discounts. It cannot exceed what is left to discount.
   */
  private invoiceDiscountShares(
    lines: PreparedLine[],
    input: InvoiceDiscountInput | undefined,
    scale: number,
  ): bigint[] {
    const bases = lines.map((line) => {
      const base = toUnits(line.gross, scale) - toUnits(line.lineDiscount, scale);
      return base > 0n ? base : 0n;
    });
    const amount = input?.amount ?? 0;
    const percent = input?.percent ?? 0;
    if (amount > 0 && percent > 0) {
      throw new BadRequestException('تخفیف فاکتور را یا به مبلغ یا به درصد وارد کنید، نه هر دو.');
    }
    const net = bases.reduce((sum, base) => sum + base, 0n);
    const discount = percent > 0 ? percentOf(net, percent) : toUnits(amount, scale);
    if (discount > net) {
      throw new BadRequestException(
        `تخفیف فاکتور (${fromUnits(discount, scale)}) از جمع خالص سطرها (${fromUnits(net, scale)}) بیشتر است.`,
      );
    }
    return allocateDiscount(bases, discount);
  }

  private invoiceDiscountOf(
    source: Pick<CreateInvoiceDto, 'invoiceDiscount' | 'invoiceDiscountPercent'>,
  ): InvoiceDiscountInput | undefined {
    if (!source.invoiceDiscount && !source.invoiceDiscountPercent) {
      return undefined;
    }
    return { amount: source.invoiceDiscount, percent: source.invoiceDiscountPercent };
  }

  /** Sum of the invoice-level discount shares on stored lines (0 for older invoices). */
  private invoiceDiscountTotal(items: InvoiceItem[]): number {
    return items.reduce((sum, item) => sum + Number(item.invoiceDiscountShare ?? 0), 0);
  }

  private computeTotals(
    items: InvoiceItem[],
    currency: Currency = Currency.IRR,
  ): InvoiceTotals {
    const scale = this.moneyScale(currency);
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

    return {
      totalAmount: this.roundTo(totalAmount, scale),
      totalDiscount: this.roundTo(totalDiscount, scale),
      totalTax: this.roundTo(totalTax, scale),
      finalPayable: this.roundTo(finalPayable, scale),
    };
  }

  private applyStatusTimestamps(
    entity: { issuedAt?: Date | null; paidAt?: Date | null },
    status: InvoiceStatus,
  ): void {
    const now = new Date();
    if (
      (status === InvoiceStatus.ISSUED || status === InvoiceStatus.PAID) &&
      !entity.issuedAt
    ) {
      entity.issuedAt = now;
    }
    if (status === InvoiceStatus.PAID && !entity.paidAt) {
      entity.paidAt = now;
    }
  }

  /**
   * The stored line discount includes the line's share of the invoice discount (posting and tax read
   * it that way). The API shows the line's OWN discount in `discount` and the share apart, read-only
   * in `invoiceDiscountShare`, so a GET sent back through PUT changes nothing.
   */
  private lineOwnDiscounts(entity: InvoiceEntity): InvoiceItem[] {
    const scale = this.moneyScale(entity.currency);
    return (entity.items ?? []).map((line) =>
      line.invoiceDiscountShare === undefined
        ? line
        : { ...line, discount: this.roundTo(Number(line.discount) - Number(line.invoiceDiscountShare), scale) },
    );
  }

  private toResponseDto(entity: InvoiceEntity): InvoiceResponseDto {
    return {
      id: entity.id,
      taxInvoiceNumber: entity.taxInvoiceNumber,
      customerId: entity.customerId ?? null,
      sellerInfo: entity.sellerInfo,
      buyerInfo: entity.buyerInfo,
      items: this.lineOwnDiscounts(entity),
      currency: entity.currency,
      jurisdiction: entity.jurisdiction,
      exchangeRate: Number(entity.exchangeRate),
      fxRate: Number(entity.fxRate),
      amountFx:
        entity.amountFx === null || entity.amountFx === undefined
          ? null
          : Number(entity.amountFx),
      baseCurrency: entity.baseCurrency,
      totalAmount: Number(entity.totalAmount),
      totalDiscount: Number(entity.totalDiscount),
      invoiceDiscount: this.roundTo(
        this.invoiceDiscountTotal(entity.items ?? []),
        this.moneyScale(entity.currency),
      ),
      totalTax: Number(entity.totalTax),
      finalPayable: Number(entity.finalPayable),
      baseTotalAmount: Number(entity.baseTotalAmount),
      baseTotalTax: Number(entity.baseTotalTax),
      baseFinalPayable: Number(entity.baseFinalPayable),
      status: entity.status,
      issuedAt: entity.issuedAt ?? null,
      paidAt: entity.paidAt ?? null,
      journalEntryId: entity.journalEntryId ?? null,
      paidJournalEntryId: entity.paidJournalEntryId ?? null,
      reversalJournalEntryId: entity.reversalJournalEntryId ?? null,
      postingError: entity.postingError ?? null,
      createdAt: entity.createdAt,
      direction: entity.direction ?? InvoiceDirection.SALE,
      einvoiceType: entity.einvoiceType ?? EInvoiceType.WITH_BUYER,
      subject: entity.subject ?? InvoiceSubject.ORIGINAL,
      relatedInvoiceId: entity.relatedInvoiceId ?? null,
      warehouseId: entity.warehouseId ?? null,
    };
  }

  /**
   * ایجاد صورتحساب جدید همراه با محاسبه آنی VAT، پیوند مشتری/کالا و
   * جلوگیری از شماره صورتحساب تکراری در همان مستأجر.
   */
  async create(
    tenantId: string,
    dto: CreateInvoiceDto,
    options: CreateInvoiceOptions = {},
  ): Promise<InvoiceResponseDto> {
    const subject = dto.subject ?? InvoiceSubject.ORIGINAL;
    if (subject === InvoiceSubject.RETURN && dto.relatedInvoiceId && !options.deferEvents) {
      // The check "returned so far + this return <= sold" and the insert run under the sale's lock.
      return this.withSaleLock(tenantId, dto.relatedInvoiceId, (deferEvents) =>
        this.create(tenantId, dto, { ...options, deferEvents }),
      );
    }
    const related = await this.resolveRelated(tenantId, dto, subject);
    // A cancel document is a copy of what it cancels; it cannot carry its own figures.
    const source: CreateInvoiceDto =
      subject === InvoiceSubject.CANCEL && related
        ? this.copyOf(related, dto)
        : dto;
    const direction = related?.direction ?? source.direction ?? InvoiceDirection.SALE;

    const taxInvoiceNumber =
      source.taxInvoiceNumber?.trim() ||
      (await this.generateInvoiceNumber(tenantId, direction));
    const existing = await this.invoicingRepository.findByTaxInvoiceNumber(
      tenantId,
      taxInvoiceNumber,
    );

    if (existing) {
      throw new ConflictException(
        `صورتحسابی با شماره ${taxInvoiceNumber} قبلاً ثبت شده است.`,
      );
    }

    const currency = source.currency ?? Currency.IRR;
    const jurisdiction =
      source.jurisdiction ?? this.defaultJurisdiction(currency);
    // A new invoice is dated today: issued now, or a draft that takes today's rate.
    const defaultVatRate = await this.defaultVatRateForJurisdiction(
      tenantId,
      jurisdiction,
      new Date(),
      source.items,
    );
    const fxRate = this.resolveFxRate(currency, source.fxRate);

    const items = await this.normalizeItems(
      tenantId,
      source.items,
      defaultVatRate,
      currency,
      this.invoiceDiscountOf(source),
    );
    const { customerId, buyerInfo, einvoiceType } = await this.resolveParties(
      tenantId,
      direction,
      source,
    );
    const totals = this.computeTotals(items, currency);

    const exchangeRate = this.currencyService.getRate(currency, BASE_CURRENCY);
    const status = source.status ?? InvoiceStatus.DRAFT;

    const entity = {
      taxInvoiceNumber,
      direction,
      einvoiceType,
      subject,
      relatedInvoiceId: related?.id ?? null,
      warehouseId: source.warehouseId ?? null,
      customerId,
      sellerInfo: source.sellerInfo,
      buyerInfo,
      items,
      currency,
      jurisdiction,
      exchangeRate,
      fxRate,
      amountFx: totals.finalPayable,
      baseCurrency: BASE_CURRENCY,
      totalAmount: totals.totalAmount,
      totalDiscount: totals.totalDiscount,
      totalTax: totals.totalTax,
      finalPayable: totals.finalPayable,
      baseTotalAmount: this.currencyService.round(
        totals.totalAmount * exchangeRate,
        BASE_CURRENCY,
      ),
      baseTotalTax: this.currencyService.round(
        totals.totalTax * exchangeRate,
        BASE_CURRENCY,
      ),
      baseFinalPayable: this.currencyService.round(
        totals.finalPayable * exchangeRate,
        BASE_CURRENCY,
      ),
      status,
      issuedAt: options.issuedAt ?? null,
      paidAt: null,
      idempotencyKey: options.idempotencyKey ?? null,
      requestHash: options.requestHash ?? null,
      payments: options.payments ?? null,
    } as Partial<InvoiceEntity>;

    this.applyStatusTimestamps(entity, status);

    const saved = await this.invoicingRepository.create(tenantId, entity, options.manager);

    if (status === InvoiceStatus.ISSUED || status === InvoiceStatus.PAID) {
      if (subject === InvoiceSubject.CANCEL) {
        await this.applyCancelSubject(tenantId, saved);
      } else if (options.deferEvents) {
        options.deferEvents.push(() => this.emitStatusEvent(tenantId, saved.id, status));
      } else {
        await this.emitStatusEvent(tenantId, saved.id, status);
      }
    }

    return this.toResponseDto(saved);
  }

  /**
   * Runs `work` while holding a lock on the sale (`lockForReturn`), so concurrent returns of the
   * same sale are checked and inserted one after the other. Status events that `work` defers are
   * sent after the lock is released.
   */
  async withSaleLock<T>(
    tenantId: string,
    saleId: string,
    work: (deferEvents: Array<() => Promise<void>>) => Promise<T>,
  ): Promise<T> {
    const deferred: Array<() => Promise<void>> = [];
    const result = await this.invoicingRepository.transaction(async (manager) => {
      await this.invoicingRepository.lockForReturn(tenantId, saleId, manager);
      return work(deferred);
    }, tenantId);
    for (const send of deferred) {
      await send();
    }
    return result;
  }

  /**
   * صورتحساب مرجع برای اصلاحی/ابطالی/برگشتی. باید در همین مستأجر، صادرشده، ابطال‌نشده و
   * اصلی باشد؛ برای برگشتی تعداد کالای برگشتی از تعداد فروخته/خریده‌شده بیشتر نمی‌شود.
   */
  private async resolveRelated(
    tenantId: string,
    dto: CreateInvoiceDto,
    subject: InvoiceSubject,
  ): Promise<InvoiceEntity | null> {
    if (subject === InvoiceSubject.ORIGINAL) {
      if (dto.relatedInvoiceId) {
        throw new BadRequestException(
          'صورتحساب اصلی صورتحساب مرجع ندارد؛ موضوع را اصلاحی، ابطالی یا برگشتی بگذارید.',
        );
      }
      return null;
    }
    if (!dto.relatedInvoiceId) {
      throw new BadRequestException(
        'برای صورتحساب اصلاحی، ابطالی یا برگشتی، صورتحساب مرجع الزامی است.',
      );
    }
    const related = await this.invoicingRepository.findById(
      tenantId,
      dto.relatedInvoiceId,
    );
    if (!related) {
      throw new NotFoundException('صورتحساب مرجع یافت نشد.');
    }
    if (
      related.status !== InvoiceStatus.ISSUED &&
      related.status !== InvoiceStatus.PAID
    ) {
      throw new BadRequestException(
        'صورتحساب مرجع باید صادرشده و ابطال‌نشده باشد.',
      );
    }
    if ((related.subject ?? InvoiceSubject.ORIGINAL) !== InvoiceSubject.ORIGINAL) {
      throw new BadRequestException(
        'صورتحساب مرجع باید از موضوع «اصلی» باشد.',
      );
    }
    if (dto.direction && dto.direction !== (related.direction ?? InvoiceDirection.SALE)) {
      throw new BadRequestException(
        'جهت (خرید/فروش) باید با صورتحساب مرجع یکی باشد.',
      );
    }
    if (subject === InvoiceSubject.RETURN) {
      await this.assertReturnWithinSold(tenantId, related, dto.items);
    }
    return related;
  }

  /** Quantity returned per SKU, including earlier returns, never exceeds what the related invoice moved. */
  private async assertReturnWithinSold(
    tenantId: string,
    related: InvoiceEntity,
    items: InvoiceItemDto[],
  ): Promise<void> {
    const sold = new Map<string, number>();
    for (const line of related.items) {
      if (line.sku) {
        sold.set(line.sku, (sold.get(line.sku) ?? 0) + line.quantity);
      }
    }
    const returned = new Map<string, number>();
    const earlier = await this.invoicingRepository.findByRelated(
      tenantId,
      related.id,
    );
    for (const doc of earlier) {
      if (
        doc.subject === InvoiceSubject.RETURN &&
        doc.status !== InvoiceStatus.CANCELLED
      ) {
        for (const line of doc.items) {
          if (line.sku) {
            returned.set(line.sku, (returned.get(line.sku) ?? 0) + line.quantity);
          }
        }
      }
    }
    for (const item of items) {
      const sku = item.sku?.trim();
      if (!sku) {
        continue;
      }
      const available = (sold.get(sku) ?? 0) - (returned.get(sku) ?? 0);
      if (item.quantity > available + 1e-9) {
        throw new BadRequestException(
          `تعداد برگشتی کالای ${sku} از باقی‌ماندهٔ قابل برگشت (${available}) بیشتر است.`,
        );
      }
    }
  }

  /** A cancel document repeats the related invoice's parties, currency and lines. */
  private copyOf(related: InvoiceEntity, dto: CreateInvoiceDto): CreateInvoiceDto {
    return {
      ...dto,
      direction: related.direction ?? InvoiceDirection.SALE,
      einvoiceType: related.einvoiceType ?? EInvoiceType.WITH_BUYER,
      sellerInfo: related.sellerInfo,
      buyerInfo: related.buyerInfo,
      customerId: related.customerId ?? undefined,
      currency: related.currency,
      jurisdiction: related.jurisdiction,
      fxRate: Number(related.fxRate),
      warehouseId: related.warehouseId ?? undefined,
      items: related.items.map((line) => ({
        itemId: line.itemId ?? undefined,
        sku: line.sku ?? undefined,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: this.roundTo(
          line.discount - (line.invoiceDiscountShare ?? 0),
          this.moneyScale(related.currency),
        ),
        vatRate: line.vatRate,
      })),
      invoiceDiscount: this.invoiceDiscountTotal(related.items) || undefined,
      invoiceDiscountPercent: undefined,
    };
  }

  /**
   * Issuing a cancel document cancels the invoice it refers to; that invoice's own cancellation
   * event then books the exact mirror entry and returns the stock.
   */
  private async applyCancelSubject(
    tenantId: string,
    cancelDoc: InvoiceEntity,
  ): Promise<void> {
    if (!cancelDoc.relatedInvoiceId) {
      return;
    }
    const related = await this.invoicingRepository.findById(
      tenantId,
      cancelDoc.relatedInvoiceId,
    );
    if (!related || related.status === InvoiceStatus.CANCELLED) {
      return;
    }
    const previous = related.status;
    related.status = InvoiceStatus.CANCELLED;
    await this.invoicingRepository.save(tenantId, related);
    if (previous === InvoiceStatus.ISSUED || previous === InvoiceStatus.PAID) {
      await this.emitStatusEvent(tenantId, related.id, InvoiceStatus.CANCELLED);
    }
  }

  /**
   * Buyer/seller for the direction. A purchase has the supplier as seller and us as buyer. A sale
   * needs no customer: with none it goes to the built-in walk-in customer and takes the anonymous
   * type of the tenant's country; a buyer is demanded only where the chosen type needs identity
   * (Iranian type 1).
   */
  private async resolveParties(
    tenantId: string,
    direction: InvoiceDirection,
    dto: CreateInvoiceDto,
  ): Promise<{
    customerId: number | null;
    buyerInfo: InvoicePartyInfo;
    einvoiceType: EInvoiceType;
  }> {
    if (direction === InvoiceDirection.PURCHASE) {
      return {
        customerId: null,
        buyerInfo: dto.buyerInfo ?? { name: await this.ownName(tenantId) },
        einvoiceType: dto.einvoiceType ?? EInvoiceType.WITHOUT_BUYER,
      };
    }
    const rule = invoiceRuleFor(await this.countryOf(tenantId));
    const hasBuyer =
      dto.customerId !== undefined || Boolean(dto.buyerInfo?.name?.trim());

    if (!hasBuyer) {
      const einvoiceType = dto.einvoiceType ?? rule.anonymousType;
      if (rule.identityNeeded(einvoiceType) !== 'none') {
        throw new BadRequestException(
          'این نوع صورتحساب مشخصات خریدار می‌خواهد؛ خریدار را وارد کنید یا نوع دوم/سوم را انتخاب کنید.',
        );
      }
      const walkIn = await this.customerIdentity?.walkIn(tenantId);
      return {
        customerId: walkIn?.id ?? null,
        buyerInfo: { name: walkIn?.fullName ?? WALK_IN_NAME },
        einvoiceType,
      };
    }

    const resolved = await this.resolveBuyer(tenantId, dto.customerId, dto.buyerInfo);
    const identified = Boolean(
      resolved.buyerInfo.nationalId?.trim() || resolved.buyerInfo.economicCode?.trim(),
    );
    const einvoiceType =
      dto.einvoiceType ??
      (identified && rule.identityNeeded(EInvoiceType.WITH_BUYER) !== 'none'
        ? EInvoiceType.WITH_BUYER
        : rule.anonymousType);
    if (rule.identityNeeded(einvoiceType) === 'tax_id' && !identified) {
      throw new BadRequestException(
        'برای این نوع صورتحساب، کد ملی یا کد اقتصادی خریدار الزامی است.',
      );
    }
    return { ...resolved, einvoiceType };
  }

  private async countryOf(tenantId: string): Promise<string | null> {
    try {
      return (await this.tenantsRepository?.findById(tenantId))?.countryCode ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Totals the server would put on an invoice for these lines, without saving anything (a POS
   * sale checks the payments against the payable before it creates the invoice).
   */
  async quote(
    tenantId: string,
    source: Pick<
      CreateInvoiceDto,
      'items' | 'currency' | 'jurisdiction' | 'fxRate' | 'invoiceDiscount' | 'invoiceDiscountPercent'
    >,
  ): Promise<{ items: InvoiceItem[]; totals: InvoiceTotals; currency: Currency }> {
    const currency = source.currency ?? Currency.IRR;
    const jurisdiction = source.jurisdiction ?? this.defaultJurisdiction(currency);
    const defaultVatRate = await this.defaultVatRateForJurisdiction(
      tenantId,
      jurisdiction,
      new Date(),
      source.items,
    );
    const items = await this.normalizeItems(
      tenantId,
      source.items,
      defaultVatRate,
      currency,
      this.invoiceDiscountOf(source),
    );
    return { items, totals: this.computeTotals(items, currency), currency };
  }

  private async ownName(tenantId: string): Promise<string> {
    try {
      const tenant = await this.tenantsRepository?.findById(tenantId);
      return tenant?.name?.trim() || 'سازمان من';
    } catch {
      return 'سازمان من';
    }
  }

  /** Unique number when the user leaves it empty: TI/PI + date + random suffix. */
  private async generateInvoiceNumber(
    tenantId: string,
    direction: InvoiceDirection,
  ): Promise<string> {
    const prefix =
      direction === InvoiceDirection.PURCHASE
        ? 'PI'
        : DEFAULT_TAX_INVOICE_NUMBER_PREFIX;
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const suffix = Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, '0');
      const candidate = `${prefix}-${day}-${suffix}`;
      if (
        !(await this.invoicingRepository.findByTaxInvoiceNumber(tenantId, candidate))
      ) {
        return candidate;
      }
    }
    throw new ConflictException('ساخت شمارهٔ یکتای صورتحساب ممکن نشد؛ دوباره تلاش کنید.');
  }

  async findAll(
    tenantId: string,
    query: QueryInvoiceDto,
  ): Promise<{
    data: InvoiceResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, status, taxInvoiceNumber, search, currency, direction } =
      query;
    const skip = (page - 1) * limit;

    if (search) {
      const [entities, total] = await this.invoicingRepository.searchAndCount(
        tenantId,
        {
          search,
          status,
          currency,
          direction,
          skip,
          take: limit,
        },
      );
      const moadianMap = await this.invoicingRepository.findMoadianSubmissionsForInvoices(
        tenantId,
        entities.map((e) => e.id),
      );
      return {
        data: entities.map((entity) => {
          const dto = this.toResponseDto(entity);
          const m = moadianMap.get(entity.id);
          if (m) {
            dto.moadianStatus = m.status;
            dto.moadianErrorText = m.errorText;
            dto.moadianTaxId = m.taxId;
          }
          return dto;
        }),
        total,
        page,
        limit,
      };
    }

    const where: FindOptionsWhere<InvoiceEntity> = { tenantId };
    if (status) {
      where.status = status;
    }
    if (taxInvoiceNumber) {
      where.taxInvoiceNumber = ILike(`%${taxInvoiceNumber}%`);
    }
    if (currency) {
      where.currency = currency;
    }
    if (direction) {
      where.direction = direction;
    }

    const [entities, total] = await this.invoicingRepository.findAndCount(
      tenantId,
      {
        where,
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
      },
    );

    const moadianMap = await this.invoicingRepository.findMoadianSubmissionsForInvoices(
      tenantId,
      entities.map((e) => e.id),
    );

    return {
      data: entities.map((entity) => {
        const dto = this.toResponseDto(entity);
        const m = moadianMap.get(entity.id);
        if (m) {
          dto.moadianStatus = m.status;
          dto.moadianErrorText = m.errorText;
          dto.moadianTaxId = m.taxId;
        }
        return dto;
      }),
      total,
      page,
      limit,
    };
  }

  async findOne(tenantId: string, id: string): Promise<InvoiceResponseDto> {
    const entity = await this.invoicingRepository.findById(tenantId, id);

    if (!entity) {
      throw new NotFoundException(`صورتحساب با شناسه ${id} یافت نشد.`);
    }

    const dto = this.toResponseDto(entity);
    const moadianMap = await this.invoicingRepository.findMoadianSubmissionsForInvoices(
      tenantId,
      [id],
    );
    const m = moadianMap.get(id);
    if (m) {
      dto.moadianStatus = m.status;
      dto.moadianErrorText = m.errorText;
      dto.moadianTaxId = m.taxId;
    }
    return dto;
  }

  /**
   * ویرایش صورتحساب. اقلام در صورت ارسال دوباره محاسبه می‌شوند و نرخ VAT هر
   * سطر روی همان سطر ذخیره می‌ماند. صورتحساب پرداخت‌شده/ابطال‌شده قابل
   * ویرایش نیست.
   */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    const entity = await this.invoicingRepository.findById(tenantId, id);
    if (!entity) {
      throw new NotFoundException(`صورتحساب با شناسه ${id} یافت نشد.`);
    }
    if (
      entity.status === InvoiceStatus.PAID ||
      entity.status === InvoiceStatus.CANCELLED
    ) {
      throw new ConflictException(
        'صورتحساب پرداخت‌شده یا ابطال‌شده قابل ویرایش نیست.',
      );
    }

    const previousStatus = entity.status;

    if (
      dto.taxInvoiceNumber !== undefined &&
      dto.taxInvoiceNumber !== entity.taxInvoiceNumber
    ) {
      const duplicate = await this.invoicingRepository.findByTaxInvoiceNumber(
        tenantId,
        dto.taxInvoiceNumber,
      );
      if (duplicate && duplicate.id !== entity.id) {
        throw new ConflictException(
          `صورتحسابی با شماره ${dto.taxInvoiceNumber} قبلاً ثبت شده است.`,
        );
      }
      entity.taxInvoiceNumber = dto.taxInvoiceNumber;
    }

    const previousCurrency = entity.currency;
    const currencyChanged =
      dto.currency !== undefined && dto.currency !== previousCurrency;
    if (currencyChanged) {
      entity.currency = dto.currency as Currency;
      entity.exchangeRate = this.currencyService.getRate(
        entity.currency,
        BASE_CURRENCY,
      );
    }

    if (dto.jurisdiction !== undefined) {
      entity.jurisdiction = dto.jurisdiction;
    } else if (currencyChanged) {
      entity.jurisdiction = this.defaultJurisdiction(entity.currency);
    }

    if (currencyChanged || dto.fxRate !== undefined) {
      entity.fxRate = this.resolveFxRate(entity.currency, dto.fxRate);
    }

    const discountChanged =
      dto.invoiceDiscount !== undefined || dto.invoiceDiscountPercent !== undefined;
    if (dto.items !== undefined || discountChanged) {
      // Lines not sent are the stored ones, net of their old invoice-discount share; an invoice
      // discount not sent keeps the stored amount (spread again over the new lines).
      const scale = this.moneyScale(entity.currency);
      const lines: InvoiceItemDto[] =
        dto.items ??
        entity.items.map((line) => ({
          itemId: line.itemId ?? undefined,
          sku: line.sku ?? undefined,
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discount: this.roundTo(Number(line.discount) - Number(line.invoiceDiscountShare ?? 0), scale),
          vatRate: Number(line.vatRate),
        }));
      // An issued invoice keeps the rate of its issue date; a draft takes today's.
      const defaultVatRate = await this.defaultVatRateForJurisdiction(
        tenantId,
        entity.jurisdiction,
        entity.issuedAt ? new Date(entity.issuedAt) : new Date(),
        lines,
      );
      const invoiceDiscount = discountChanged
        ? this.invoiceDiscountOf(dto)
        : this.invoiceDiscountOf({ invoiceDiscount: this.invoiceDiscountTotal(entity.items) });
      const items = await this.normalizeItems(
        tenantId,
        lines,
        defaultVatRate,
        entity.currency,
        invoiceDiscount,
      );
      const totals = this.computeTotals(items, entity.currency);
      entity.items = items;
      entity.totalAmount = totals.totalAmount;
      entity.totalDiscount = totals.totalDiscount;
      entity.totalTax = totals.totalTax;
      entity.finalPayable = totals.finalPayable;
      entity.baseTotalAmount = this.currencyService.round(
        totals.totalAmount * Number(entity.exchangeRate),
        BASE_CURRENCY,
      );
      entity.baseTotalTax = this.currencyService.round(
        totals.totalTax * Number(entity.exchangeRate),
        BASE_CURRENCY,
      );
      entity.baseFinalPayable = this.currencyService.round(
        totals.finalPayable * Number(entity.exchangeRate),
        BASE_CURRENCY,
      );
    }

    if (currencyChanged) {
      entity.baseTotalAmount = this.currencyService.round(
        Number(entity.totalAmount) * Number(entity.exchangeRate),
        BASE_CURRENCY,
      );
      entity.baseTotalTax = this.currencyService.round(
        Number(entity.totalTax) * Number(entity.exchangeRate),
        BASE_CURRENCY,
      );
      entity.baseFinalPayable = this.currencyService.round(
        Number(entity.finalPayable) * Number(entity.exchangeRate),
        BASE_CURRENCY,
      );
    }

    if (dto.customerId !== undefined || dto.buyerInfo !== undefined) {
      const resolved = await this.resolveBuyer(
        tenantId,
        dto.customerId ?? entity.customerId ?? undefined,
        dto.buyerInfo,
      );
      entity.customerId = resolved.customerId;
      entity.buyerInfo = resolved.buyerInfo;
    }
    if (dto.sellerInfo !== undefined) {
      entity.sellerInfo = dto.sellerInfo;
    }
    if (dto.warehouseId !== undefined) {
      entity.warehouseId = dto.warehouseId;
    }
    if (dto.status !== undefined) {
      entity.status = dto.status;
      this.applyStatusTimestamps(entity, dto.status);
    }

    entity.amountFx = Number(entity.finalPayable);

    const saved = await this.invoicingRepository.save(tenantId, entity);

    if (
      dto.status !== undefined &&
      entity.status !== previousStatus &&
      entity.subject === InvoiceSubject.CANCEL
    ) {
      if (
        entity.status === InvoiceStatus.ISSUED ||
        entity.status === InvoiceStatus.PAID
      ) {
        await this.applyCancelSubject(tenantId, saved);
      }
    } else if (dto.status !== undefined && entity.status !== previousStatus) {
      await this.emitStatusTransition(
        tenantId,
        saved.id,
        previousStatus,
        entity.status,
      );
    }

    return this.toResponseDto(saved);
  }

  /** انتشار رویداد مناسب بر اساس گذر وضعیت (صدور/تسویه/ابطال). */
  private async emitStatusTransition(
    tenantId: string,
    invoiceId: string,
    previousStatus: InvoiceStatus,
    nextStatus: InvoiceStatus,
  ): Promise<void> {
    if (nextStatus === InvoiceStatus.ISSUED) {
      await this.emitStatusEvent(tenantId, invoiceId, InvoiceStatus.ISSUED);
    } else if (nextStatus === InvoiceStatus.PAID) {
      await this.emitStatusEvent(tenantId, invoiceId, InvoiceStatus.PAID);
    } else if (
      nextStatus === InvoiceStatus.CANCELLED &&
      (previousStatus === InvoiceStatus.ISSUED ||
        previousStatus === InvoiceStatus.PAID)
    ) {
      await this.emitStatusEvent(tenantId, invoiceId, InvoiceStatus.CANCELLED);
    }
  }

  /**
   * علامت‌گذاری صورتحساب به‌عنوان پرداخت‌شده. صورتحساب ابطال‌شده یا
   * پرداخت‌شده قبلی پذیرفته نمی‌شود.
   */
  async pay(tenantId: string, id: string): Promise<InvoiceResponseDto> {
    const entity = await this.invoicingRepository.findById(tenantId, id);
    if (!entity) {
      throw new NotFoundException(`صورتحساب با شناسه ${id} یافت نشد.`);
    }
    if (entity.status === InvoiceStatus.CANCELLED) {
      throw new ConflictException('صورتحساب ابطال‌شده قابل پرداخت نیست.');
    }
    if (entity.subject === InvoiceSubject.CANCEL) {
      throw new ConflictException('صورتحساب ابطالی پرداخت ندارد.');
    }
    if (entity.status === InvoiceStatus.PAID) {
      throw new ConflictException('این صورتحساب قبلاً پرداخت شده است.');
    }

    entity.status = InvoiceStatus.PAID;
    entity.paidAt = new Date();
    if (!entity.issuedAt) {
      entity.issuedAt = entity.paidAt;
    }

    const saved = await this.invoicingRepository.save(tenantId, entity);
    await this.emitStatusEvent(tenantId, saved.id, InvoiceStatus.PAID);
    return this.toResponseDto(saved);
  }

  /**
   * ابطال صورتحساب. صورتحساب ابطال‌شده قابل ابطال مجدد نیست.
   */
  async cancel(tenantId: string, id: string): Promise<InvoiceResponseDto> {
    const entity = await this.invoicingRepository.findById(tenantId, id);

    if (!entity) {
      throw new NotFoundException(`صورتحساب با شناسه ${id} یافت نشد.`);
    }

    if (entity.status === InvoiceStatus.CANCELLED) {
      throw new ConflictException('این صورتحساب قبلاً ابطال شده است.');
    }

    const previousStatus = entity.status;
    entity.status = InvoiceStatus.CANCELLED;
    const saved = await this.invoicingRepository.save(tenantId, entity);

    if (
      previousStatus === InvoiceStatus.ISSUED ||
      previousStatus === InvoiceStatus.PAID
    ) {
      await this.emitStatusEvent(tenantId, saved.id, InvoiceStatus.CANCELLED);
    }

    return this.toResponseDto(saved);
  }

  /**
   * خلاصه فقط‌خواندنی صورتحساب‌ها به تفکیک ارز و وضعیت (دستیار هوشمند).
   * مبالغ به ارز خود صورتحساب‌اند و تبدیل نمی‌شوند.
   */
  async summarize(
    tenantId: string,
    options: {
      statuses: InvoiceStatus[];
      from?: Date;
      to?: Date;
      buyerSearch?: string;
    },
  ): Promise<InvoiceSummaryRow[]> {
    if (options.statuses.length === 0) {
      return [];
    }
    return this.invoicingRepository.summarize(tenantId, options);
  }

  // ---------------------------------------------------------------------------
  // ورود بستهٔ دیتابیس (Database package import)
  // ---------------------------------------------------------------------------

  /** شماره‌های صورتحساب موجودِ مستأجر در میان فهرست داده‌شده (تشخیص تکراری). */
  async findExistingInvoiceNumbers(
    tenantId: string,
    numbers: string[],
  ): Promise<string[]> {
    const found: string[] = [];
    for (const number of numbers) {
      const existing = await this.invoicingRepository.findByTaxInvoiceNumber(
        tenantId,
        number,
      );
      if (existing) {
        found.push(existing.taxInvoiceNumber);
      }
    }
    return found;
  }

  /**
   * درج صورتحساب‌ها از مسیر ورود بستهٔ دیتابیس.
   *
   * ردیف‌های هم‌شماره یک صورتحساب چندسطری می‌سازند؛ تکرار دقیق یک ردیف فقط یک
   * بار شمرده می‌شود. همهٔ سطرها پیش از درج با واحد پول صحیح (money.ts)
   * اعتبارسنجی می‌شوند و هر صورتحساب با وضعیت DRAFT و بدون هیچ رویداد ثبت
   * (posting) ساخته می‌شود؛ صدور/ثبت سند در گام‌های بعدی گردش وضعیت انجام می‌شود.
   */
  async importInvoices(
    tenantId: string,
    inputs: InvoicingImportInput[],
  ): Promise<InvoiceImportRowResult[]> {
    const rows: InvoiceImportRow[] = inputs.map((input, index) => ({
      rowNumber: input.rowNumber ?? index + 2,
      number: String(input.number ?? ''),
      type: input.type,
      date: input.date,
      partyCode: input.partyCode,
      itemCode: input.itemCode,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      amount: input.amount,
      vat: input.vat,
      totalRial: input.totalRial,
      currency: input.currency,
      fxRate: input.fxRate,
    }));

    const resultByRow = new Map<number, InvoiceImportRowResult>();
    const results: InvoiceImportRowResult[] = rows.map((row) => {
      const result: InvoiceImportRowResult = {
        rowNumber: row.rowNumber,
        invoiceNumber: String(row.number ?? '').trim(),
        invoiceId: null,
        error: null,
        duplicate: false,
        existingDuplicate: false,
      };
      resultByRow.set(result.rowNumber, result);
      return result;
    });

    const plans = groupInvoiceRows(rows, await this.importLookups(tenantId, rows));

    const existingNumbers = new Set(
      await this.findExistingInvoiceNumbers(
        tenantId,
        plans.map((plan) => plan.invoiceNumber),
      ),
    );

    for (const plan of plans) {
      const rowResults = plan.rowNumbers
        .map((rowNumber) => resultByRow.get(rowNumber))
        .filter((result): result is InvoiceImportRowResult => Boolean(result));
      for (const duplicate of plan.duplicateRows) {
        const result = resultByRow.get(duplicate.rowNumber);
        if (result) {
          result.duplicate = true;
        }
      }
      if (rowResults.length === 0 || rowResults[0].duplicate) {
        continue;
      }
      if (existingNumbers.has(plan.invoiceNumber)) {
        for (const result of rowResults) {
          result.existingDuplicate = true;
        }
        continue;
      }
      if (!plan.valid) {
        for (const [rowNumber, message] of plan.rowErrors) {
          const result = resultByRow.get(rowNumber);
          if (result) {
            result.error = message;
          }
        }
        continue;
      }
      try {
        const created = await this.create(tenantId, await this.importedDtoFromPlan(tenantId, plan));
        if (plan.date) {
          const entity = await this.invoicingRepository.findById(tenantId, created.id);
          if (entity && !entity.issuedAt) {
            entity.issuedAt = plan.date;
            await this.invoicingRepository.save(tenantId, entity);
          }
        }
        for (const line of plan.lines) {
          const result = resultByRow.get(line.rowNumber);
          if (result) {
            result.invoiceId = created.id;
          }
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'درج صورتحساب ناموفق بود.';
        for (const result of rowResults) {
          result.error = message;
        }
      }
    }

    return results;
  }

  private async importLookups(
    tenantId: string,
    rows: InvoiceImportRow[],
  ): Promise<{
    partyByCode: Map<string, ImportedPartyRef>;
    existingSkus: Set<string>;
  }> {
    const partyCodes = new Set<string>();
    const skus = new Set<string>();
    for (const row of rows) {
      const partyCode = String(row.partyCode ?? '').trim();
      if (partyCode) {
        partyCodes.add(partyCode);
      }
      const sku = String(row.itemCode ?? '').trim();
      if (sku) {
        skus.add(sku);
      }
    }

    const partyByCode = new Map<string, ImportedPartyRef>();
    if (this.partiesService && partyCodes.size > 0) {
      const existing = await this.partiesService
        .findExistingCodes(tenantId, Array.from(partyCodes))
        .catch(() => []);
      for (const code of existing) {
        try {
          const party = await this.partiesService.getByCode(tenantId, code);
          partyByCode.set(code, {
            id: party.id,
            code: party.code,
            name: party.name,
            nationalId: party.nationalId,
            economicCode: party.economicCode,
          });
        } catch {
          continue;
        }
      }
    }

    const existingSkus = new Set<string>();
    if (skus.size > 0 && this.inventoryRepository) {
      const skuList = Array.from(skus);
      if (typeof this.inventoryRepository.findStockItemSkus === 'function') {
        for (const sku of await this.inventoryRepository.findStockItemSkus(tenantId, skuList)) {
          existingSkus.add(sku);
        }
      } else {
        for (const sku of skuList) {
          const item = await this.inventoryRepository.findStockItemBySku(tenantId, sku);
          if (item?.sku) {
            existingSkus.add(item.sku);
          }
        }
      }
    }

    return { partyByCode, existingSkus };
  }

  private async importedDtoFromPlan(
    tenantId: string,
    plan: InvoiceImportPlan,
  ): Promise<CreateInvoiceDto> {
    const direction = plan.direction ?? InvoiceDirection.SALE;
    const dto: CreateInvoiceDto = {
      taxInvoiceNumber: plan.invoiceNumber,
      direction,
      sellerInfo:
        direction === InvoiceDirection.PURCHASE && plan.party
          ? this.importedPartyInfo(plan.party)
          : { name: await this.ownName(tenantId) },
      items: plan.lines.map((line) => ({
        sku: line.sku,
        quantity: line.quantity,
        unitPrice: Number(fromMinor(line.unitPriceMinor)),
        vatRate: line.vatRate,
      })),
    };
    if (direction === InvoiceDirection.SALE && plan.party) {
      dto.buyerInfo = this.importedPartyInfo(plan.party);
    }
    if (plan.currency) {
      dto.currency = plan.currency;
    }
    if (plan.fxRate !== null) {
      dto.fxRate = plan.fxRate;
    }
    return dto;
  }

  private importedPartyInfo(party: ImportedPartyRef): InvoicePartyInfoDto {
    return {
      name: party.name,
      ...(party.nationalId?.trim() ? { nationalId: party.nationalId.trim() } : {}),
      ...(party.economicCode?.trim() ? { economicCode: party.economicCode.trim() } : {}),
    };
  }

  /** حذف صورتحساب‌های یک دسته ورود داده (undo). */
  async removeImportedInvoices(
    tenantId: string,
    ids: Array<number | string>,
  ): Promise<{ removed: number }> {
    const removed = await this.invoicingRepository.deleteByIds(
      tenantId,
      ids.map((id) => String(id)),
    );
    return { removed };
  }
}
