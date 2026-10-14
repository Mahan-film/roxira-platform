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
}
