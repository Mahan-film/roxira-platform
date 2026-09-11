import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FindOptionsWhere, ILike } from 'typeorm';
import { BASE_CURRENCY } from '../../currency/constants/currency.constants';
import { Currency } from '../../currency/enums/currency.enum';
import { CurrencyService } from '../../currency/services/currency.service';
import { MONEY_SCALE, VAT_RATE } from '../constants/invoicing.constants';
import { CreateInvoiceDto, InvoiceItemDto } from '../dto/create-invoice.dto';
import { InvoiceResponseDto } from '../dto/invoice-response.dto';
import { QueryInvoiceDto } from '../dto/query-invoice.dto';
import { InvoiceEntity, InvoiceItem } from '../entities/invoice.entity';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { InvoicingRepository } from '../repositories/invoicing.repository';

/**
 * سرویس صورتحساب مالیاتی هوشمند (Smart Invoicing).
 *
 * تمام منطق کسب‌وکار (محاسبه آنی مالیات ۹٪، جمع‌بندی مبالغ، کنترل یکتایی
 * شماره صورتحساب و گردش وضعیت) اینجا قرار دارد؛ Controller فقط مسیریابی
 * می‌کند و Repository فقط پرسیستنس انجام می‌دهد (Rule #3 - AGENTS.md).
 */
@Injectable()
export class InvoicingService {
  constructor(
    private readonly invoicingRepository: InvoicingRepository,
    private readonly currencyService: CurrencyService,
  ) {}

  /** گرد کردن مبالغ ریالی تا ۲ رقم اعشار. */
  private round(value: number): number {
    const factor = 10 ** MONEY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  /**
   * نرمال‌سازی و بازمحاسبه معتبر اقلام:
   *   gross    = quantity × unitPrice
   *   taxable  = max(0, gross - discount)
   *   tax      = taxable × 9%
   *   total    = taxable + tax
   */
  private normalizeItems(items: InvoiceItemDto[]): InvoiceItem[] {
    return items.map((item) => {
      const gross = item.quantity * item.unitPrice;
      const discount = item.discount ?? 0;
      const taxable = Math.max(0, gross - discount);
      const tax = this.round(taxable * VAT_RATE);
      const total = this.round(taxable + tax);

      return {
        description: item.description,
        quantity: item.quantity,
        unitPrice: this.round(item.unitPrice),
        discount: this.round(discount),
        tax,
        total,
      };
    });
  }

  private toResponseDto(entity: InvoiceEntity): InvoiceResponseDto {
    return {
      id: entity.id,
      taxInvoiceNumber: entity.taxInvoiceNumber,
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
      createdAt: entity.createdAt,
    };
  }

  /**
   * ایجاد صورتحساب جدید همراه با محاسبه آنی مالیات ۹٪ و جلوگیری از
   * شماره صورتحساب تکراری.
   */
  async create(dto: CreateInvoiceDto): Promise<InvoiceResponseDto> {
    const existing = await this.invoicingRepository.findByTaxInvoiceNumber(
      dto.taxInvoiceNumber,
    );

    if (existing) {
      throw new ConflictException(
        `صورتحسابی با شماره ${dto.taxInvoiceNumber} قبلاً ثبت شده است.`,
      );
    }

    const items = this.normalizeItems(dto.items);

    const currency = dto.currency ?? Currency.IRR;
    const exchangeRate = this.currencyService.getRate(currency, BASE_CURRENCY);

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

    const roundedTotalAmount = this.round(totalAmount);
    const roundedTotalTax = this.round(totalTax);
    const roundedFinalPayable = this.round(finalPayable);

    const saved = await this.invoicingRepository.create({
      taxInvoiceNumber: dto.taxInvoiceNumber,
      sellerInfo: dto.sellerInfo,
      buyerInfo: dto.buyerInfo,
      items,
      currency,
      exchangeRate,
      baseCurrency: BASE_CURRENCY,
      totalAmount: roundedTotalAmount,
      totalDiscount: this.round(totalDiscount),
      totalTax: roundedTotalTax,
      finalPayable: roundedFinalPayable,
      baseTotalAmount: this.currencyService.round(
        roundedTotalAmount * exchangeRate,
        BASE_CURRENCY,
      ),
      baseTotalTax: this.currencyService.round(
        roundedTotalTax * exchangeRate,
        BASE_CURRENCY,
      ),
      baseFinalPayable: this.currencyService.round(
        roundedFinalPayable * exchangeRate,
        BASE_CURRENCY,
      ),
      status: dto.status ?? InvoiceStatus.DRAFT,
    });

    return this.toResponseDto(saved);
  }

  async findAll(query: QueryInvoiceDto): Promise<{
    data: InvoiceResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, status, taxInvoiceNumber, currency } = query;

    const where: FindOptionsWhere<InvoiceEntity> = {};
    if (status) {
      where.status = status;
    }
    if (taxInvoiceNumber) {
      where.taxInvoiceNumber = ILike(`%${taxInvoiceNumber}%`);
    }
    if (currency) {
      where.currency = currency;
    }

    const [entities, total] = await this.invoicingRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: entities.map((entity) => this.toResponseDto(entity)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string): Promise<InvoiceResponseDto> {
    const entity = await this.invoicingRepository.findById(id);

    if (!entity) {
      throw new NotFoundException(`صورتحساب با شناسه ${id} یافت نشد.`);
    }

    return this.toResponseDto(entity);
  }

  /**
   * ابطال صورتحساب. صورتحساب ابطال‌شده قابل ابطال مجدد نیست.
   */
  async cancel(id: string): Promise<InvoiceResponseDto> {
    const entity = await this.invoicingRepository.findById(id);

    if (!entity) {
      throw new NotFoundException(`صورتحساب با شناسه ${id} یافت نشد.`);
    }

    if (entity.status === InvoiceStatus.CANCELLED) {
      throw new ConflictException('این صورتحساب قبلاً ابطال شده است.');
    }

    entity.status = InvoiceStatus.CANCELLED;
    const saved = await this.invoicingRepository.save(entity);

    return this.toResponseDto(saved);
  }
}
