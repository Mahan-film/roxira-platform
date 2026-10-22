import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, FindOptionsWhere, Repository } from 'typeorm';
import { InvoiceEntity } from '../entities/invoice.entity';

/**
 * لایه Repository - تنها نقطه دسترسی به پایگاه‌داده برای ماژول Invoicing.
 * Controller/Service هرگز نباید مستقیماً به TypeORM Repository دسترسی داشته باشند
 * (Rule #3 - AGENTS.md: Repository Pattern).
 *
 * همه متدها `tenantId` را به‌عنوان پارامتر اول می‌گیرند و هر خواندن/نوشتن را به
 * همان مستأجر محدود می‌کنند تا هیچ داده‌ای از سازمان دیگر خوانده یا تغییر نکند
 * (Rule #4 - AGENTS.md: جداسازی مستأجر در لایه Repository).
 */
@Injectable()
export class InvoicingRepository {
  constructor(
    @InjectRepository(InvoiceEntity)
    private readonly repository: Repository<InvoiceEntity>,
  ) {}

  async create(
    tenantId: string,
    data: Partial<InvoiceEntity>,
  ): Promise<InvoiceEntity> {
    const entity = this.repository.create({ ...data, tenantId });
    return this.repository.save(entity);
  }

  async save(
    tenantId: string,
    entity: InvoiceEntity,
  ): Promise<InvoiceEntity> {
    // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
    await this.repository.update(
      { id: entity.id, tenantId },
      {
        taxInvoiceNumber: entity.taxInvoiceNumber,
        customerId: entity.customerId,
        sellerInfo: entity.sellerInfo,
        buyerInfo: entity.buyerInfo,
        items: entity.items,
        currency: entity.currency,
        exchangeRate: entity.exchangeRate,
        baseCurrency: entity.baseCurrency,
        totalAmount: entity.totalAmount,
        totalDiscount: entity.totalDiscount,
        totalTax: entity.totalTax,
        finalPayable: entity.finalPayable,
        baseTotalAmount: entity.baseTotalAmount,
        baseTotalTax: entity.baseTotalTax,
        baseFinalPayable: entity.baseFinalPayable,
        status: entity.status,
        issuedAt: entity.issuedAt,
        paidAt: entity.paidAt,
      },
    );
    entity.tenantId = tenantId;
    return entity;
  }

  async findById(tenantId: string, id: string): Promise<InvoiceEntity | null> {
    return this.repository.findOne({ where: { id, tenantId } });
  }

  async findByTaxInvoiceNumber(
    tenantId: string,
    taxInvoiceNumber: string,
  ): Promise<InvoiceEntity | null> {
    return this.repository.findOne({
      where: { taxInvoiceNumber, tenantId },
    });
  }

  async findAndCount(
    tenantId: string,
    options: FindManyOptions<InvoiceEntity>,
  ): Promise<[InvoiceEntity[], number]> {
    const where = (options.where ?? {}) as FindOptionsWhere<InvoiceEntity>;
    return this.repository.findAndCount({
      ...options,
      where: { ...where, tenantId },
    });
  }

  /**
   * جست‌وجوی مستأجرمحور در شماره صورتحساب و نام خریدار.
   * فیلترهای وضعیت/ارز به‌صورت ترکیبی و همه با قید `tenantId` اعمال می‌شوند.
   */
  async searchAndCount(
    tenantId: string,
    options: {
      search: string;
      status?: InvoiceEntity['status'];
      currency?: InvoiceEntity['currency'];
      skip: number;
      take: number;
    },
  ): Promise<[InvoiceEntity[], number]> {
    const query = this.repository
      .createQueryBuilder('invoice')
      .where('invoice.tenantId = :tenantId', { tenantId });

    if (options.search) {
      const pattern = `%${options.search}%`;
      query.andWhere(
        "(invoice.taxInvoiceNumber ILIKE :pattern OR invoice.buyerInfo ->> 'name' ILIKE :pattern)",
        { pattern },
      );
    }
    if (options.status) {
      query.andWhere('invoice.status = :status', { status: options.status });
    }
    if (options.currency) {
      query.andWhere('invoice.currency = :currency', {
        currency: options.currency,
      });
    }

    query
      .orderBy('invoice.createdAt', 'DESC')
      .skip(options.skip)
      .take(options.take);

    return query.getManyAndCount();
  }
}
