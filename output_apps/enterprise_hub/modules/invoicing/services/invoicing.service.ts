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
import { FindOptionsWhere, ILike } from 'typeorm';
import { CrmRepository } from '../../crm/repositories/crm.repository';
import { BASE_CURRENCY } from '../../currency/constants/currency.constants';
import { Currency } from '../../currency/enums/currency.enum';
import { CurrencyService } from '../../currency/services/currency.service';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import {
  DEFAULT_VAT_RATE,
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
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { InvoicingRepository } from '../repositories/invoicing.repository';

/** مجموع‌های محاسبه‌شده سمت سرور برای اقلام صورتحساب. */
interface InvoiceTotals {
  totalAmount: number;
  totalDiscount: number;
  totalTax: number;
  finalPayable: number;
}

/** ورودی درج یک صورتحساب از مسیر ورود بستهٔ دیتابیس. */
export interface InvoicingImportInput {
  number: string;
  type?: string;
  date?: string;
  partyCode?: string;
  currency?: string;
  amount?: number;
  fxRate?: number;
  vat?: number;
  totalRial?: number;
  status?: string;
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
  ) {}

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
    const factor = 10 ** MONEY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  /**
   * نرمال‌سازی نرخ VAT: ورودی می‌تواند نسبت (۰٫۱) یا درصد (۱۰) باشد؛
   * خروجی همیشه نسبت در بازه ۰ تا ۱ است.
   */
  private normalizeVatRate(value: number | undefined, fallback: number): number {
    if (value === undefined || value === null) {
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
    if (!Number.isFinite(value) || value < 0) return DEFAULT_VAT_RATE;
    let rate = value > 1 ? value / 100 : value;
    if (rate > 1) rate = 1;
    return Math.round((rate + Number.EPSILON) * 10000) / 10000;
  }

  /** نرخ پیش‌فرض VAT مستأجر؛ در نبود تنظیم، ۱۰٪. */
  private async resolveDefaultVatRate(tenantId: string): Promise<number> {
    if (!this.tenantsRepository) {
      return DEFAULT_VAT_RATE;
    }
    try {
      if (typeof this.tenantsRepository.findDefaultVatRate === 'function') {
        return this.roundRate(
          await this.tenantsRepository.findDefaultVatRate(tenantId),
        );
      }
      const tenant = await this.tenantsRepository.findById(tenantId);
      return this.roundRate(tenant?.defaultVatRate ?? DEFAULT_VAT_RATE);
    } catch {
      return DEFAULT_VAT_RATE;
    }
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

  /** نرخ پیش‌فرض VAT بر مبنای حوزه: INTL صفر، IR تنظیم مستأجر (۱۰٪). */
  private defaultVatRateForJurisdiction(
    jurisdiction: InvoiceJurisdiction,
    tenantVatRate: number,
  ): number {
    return jurisdiction === InvoiceJurisdiction.INTL
      ? INTL_DEFAULT_VAT_RATE
      : tenantVatRate;
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
   *   taxable  = max(0, gross - discount)
   *   tax      = taxable × vatRate (نرخ ذخیره‌شده روی همان سطر)
   *   total    = taxable + tax
   */
  private async normalizeItems(
    tenantId: string,
    items: InvoiceItemDto[],
    defaultVatRate: number,
  ): Promise<InvoiceItem[]> {
    const normalized: InvoiceItem[] = [];

    for (const item of items) {
      let itemId = item.itemId ?? null;
      let sku = item.sku?.trim() || null;
      let derivedDescription: string | undefined;
      let derivedSku: string | undefined;

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

      const gross = item.quantity * item.unitPrice;
      const discount = item.discount ?? 0;
      const taxable = Math.max(0, gross - discount);
      const vatRate = this.normalizeVatRate(item.vatRate, defaultVatRate);
      const tax = this.round(taxable * vatRate);
      const total = this.round(taxable + tax);

      normalized.push({
        itemId,
        sku,
        description,
        quantity: item.quantity,
        unitPrice: this.round(item.unitPrice),
        discount: this.round(discount),
        vatRate,
        tax,
        total,
      });
    }

    return normalized;
  }

  private computeTotals(items: InvoiceItem[]): InvoiceTotals {
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
      totalAmount: this.round(totalAmount),
      totalDiscount: this.round(totalDiscount),
      totalTax: this.round(totalTax),
      finalPayable: this.round(finalPayable),
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

  private toResponseDto(entity: InvoiceEntity): InvoiceResponseDto {
    return {
      id: entity.id,
      taxInvoiceNumber: entity.taxInvoiceNumber,
      customerId: entity.customerId ?? null,
      sellerInfo: entity.sellerInfo,
      buyerInfo: entity.buyerInfo,
      items: entity.items,
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
    };
  }

  /**
   * ایجاد صورتحساب جدید همراه با محاسبه آنی VAT، پیوند مشتری/کالا و
   * جلوگیری از شماره صورتحساب تکراری در همان مستأجر.
   */
  async create(
    tenantId: string,
    dto: CreateInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    const existing = await this.invoicingRepository.findByTaxInvoiceNumber(
      tenantId,
      dto.taxInvoiceNumber,
    );

    if (existing) {
      throw new ConflictException(
        `صورتحسابی با شماره ${dto.taxInvoiceNumber} قبلاً ثبت شده است.`,
      );
    }

    const currency = dto.currency ?? Currency.IRR;
    const jurisdiction =
      dto.jurisdiction ?? this.defaultJurisdiction(currency);
    const tenantVatRate = await this.resolveDefaultVatRate(tenantId);
    const defaultVatRate = this.defaultVatRateForJurisdiction(
      jurisdiction,
      tenantVatRate,
    );
    const fxRate = this.resolveFxRate(currency, dto.fxRate);

    const items = await this.normalizeItems(tenantId, dto.items, defaultVatRate);
    const { customerId, buyerInfo } = await this.resolveBuyer(
      tenantId,
      dto.customerId,
      dto.buyerInfo,
    );
    const totals = this.computeTotals(items);

    const exchangeRate = this.currencyService.getRate(currency, BASE_CURRENCY);
    const status = dto.status ?? InvoiceStatus.DRAFT;

    const entity = {
      taxInvoiceNumber: dto.taxInvoiceNumber,
      customerId,
      sellerInfo: dto.sellerInfo,
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
      issuedAt: null,
      paidAt: null,
    } as Partial<InvoiceEntity>;

    this.applyStatusTimestamps(entity, status);

    const saved = await this.invoicingRepository.create(tenantId, entity);

    if (status === InvoiceStatus.ISSUED || status === InvoiceStatus.PAID) {
      await this.emitStatusEvent(tenantId, saved.id, status);
    }

    return this.toResponseDto(saved);
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
    const { page, limit, status, taxInvoiceNumber, search, currency } = query;
    const skip = (page - 1) * limit;

    if (search) {
      const [entities, total] = await this.invoicingRepository.searchAndCount(
        tenantId,
        {
          search,
          status,
          currency,
          skip,
          take: limit,
        },
      );
      return {
        data: entities.map((entity) => this.toResponseDto(entity)),
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

    const [entities, total] = await this.invoicingRepository.findAndCount(
      tenantId,
      {
        where,
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
      },
    );

    return {
      data: entities.map((entity) => this.toResponseDto(entity)),
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

    return this.toResponseDto(entity);
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

    const tenantVatRate = await this.resolveDefaultVatRate(tenantId);

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

    if (dto.items !== undefined) {
      const defaultVatRate = this.defaultVatRateForJurisdiction(
        entity.jurisdiction,
        tenantVatRate,
      );
      const items = await this.normalizeItems(
        tenantId,
        dto.items,
        defaultVatRate,
      );
      const totals = this.computeTotals(items);
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
    if (dto.status !== undefined) {
      entity.status = dto.status;
      this.applyStatusTimestamps(entity, dto.status);
    }

    entity.amountFx = Number(entity.finalPayable);

    const saved = await this.invoicingRepository.save(tenantId, entity);

    if (dto.status !== undefined && entity.status !== previousStatus) {
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
   * هر ردیف به یک اقلام خلاصه نگاشت می‌شود؛ مبلغ از ستون‌های مبلغ/جمع نهایی
   * گرفته می‌شود. فیلدهای چندارزی صورتحساب در تسک موازی اضافه می‌شوند و تا آن
   * زمان فقط ارزهای پشتیبانی‌شدهٔ سرویس پذیرفته می‌شود.
   */
  async importInvoices(
    tenantId: string,
    inputs: InvoicingImportInput[],
  ): Promise<string[]> {
    const ids: string[] = [];
    const supported = new Set<string>(Object.values(Currency));

    for (const input of inputs) {
      const unitPrice = Math.max(
        input.amount ?? input.totalRial ?? 0,
        0.01,
      );
      const currency =
        input.currency && supported.has(input.currency)
          ? (input.currency as Currency)
          : undefined;

      const dto: CreateInvoiceDto = {
        taxInvoiceNumber: input.number,
        sellerInfo: { name: 'نامشخص' },
        buyerInfo: {
          name: input.partyCode ? `طرف حساب ${input.partyCode}` : 'نامشخص',
        },
        items: [
          {
            description: `ورود بسته (${input.number})`,
            quantity: 1,
            unitPrice,
          },
        ],
      };
      if (currency) {
        dto.currency = currency;
      }
      if (
        input.fxRate !== undefined &&
        Number.isFinite(input.fxRate) &&
        input.fxRate > 0
      ) {
        dto.fxRate = input.fxRate;
      }

      const created = await this.create(tenantId, dto);
      ids.push(created.id);
    }

    return ids;
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
