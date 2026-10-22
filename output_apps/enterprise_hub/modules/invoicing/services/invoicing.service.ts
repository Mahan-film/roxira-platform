import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { FindOptionsWhere, ILike } from 'typeorm';
import { CrmRepository } from '../../crm/repositories/crm.repository';
import { BASE_CURRENCY } from '../../currency/constants/currency.constants';
import { Currency } from '../../currency/enums/currency.enum';
import { CurrencyService } from '../../currency/services/currency.service';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import {
  DEFAULT_VAT_RATE,
  MONEY_SCALE,
} from '../constants/invoicing.constants';
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
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { InvoicingRepository } from '../repositories/invoicing.repository';

/** مجموع‌های محاسبه‌شده سمت سرور برای اقلام صورتحساب. */
interface InvoiceTotals {
  totalAmount: number;
  totalDiscount: number;
  totalTax: number;
  finalPayable: number;
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
  constructor(
    private readonly invoicingRepository: InvoicingRepository,
    private readonly currencyService: CurrencyService,
    @Optional() private readonly crmRepository?: CrmRepository,
    @Optional()
    private readonly inventoryRepository?: InventoryRepository,
    @Optional() private readonly tenantsRepository?: TenantsRepository,
  ) {}

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
      exchangeRate: Number(entity.exchangeRate),
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

    const defaultVatRate = await this.resolveDefaultVatRate(tenantId);
    const items = await this.normalizeItems(tenantId, dto.items, defaultVatRate);
    const { customerId, buyerInfo } = await this.resolveBuyer(
      tenantId,
      dto.customerId,
      dto.buyerInfo,
    );
    const totals = this.computeTotals(items);

    const currency = dto.currency ?? Currency.IRR;
    const exchangeRate = this.currencyService.getRate(currency, BASE_CURRENCY);
    const status = dto.status ?? InvoiceStatus.DRAFT;

    const entity = {
      taxInvoiceNumber: dto.taxInvoiceNumber,
      customerId,
      sellerInfo: dto.sellerInfo,
      buyerInfo,
      items,
      currency,
      exchangeRate,
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

    const defaultVatRate = await this.resolveDefaultVatRate(tenantId);

    if (dto.items !== undefined) {
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
    if (dto.currency !== undefined && dto.currency !== entity.currency) {
      entity.currency = dto.currency;
      entity.exchangeRate = this.currencyService.getRate(
        dto.currency,
        BASE_CURRENCY,
      );
    }
    if (dto.status !== undefined) {
      entity.status = dto.status;
      this.applyStatusTimestamps(entity, dto.status);
    }

    const saved = await this.invoicingRepository.save(tenantId, entity);
    return this.toResponseDto(saved);
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

    entity.status = InvoiceStatus.CANCELLED;
    const saved = await this.invoicingRepository.save(tenantId, entity);

    return this.toResponseDto(saved);
  }
}
