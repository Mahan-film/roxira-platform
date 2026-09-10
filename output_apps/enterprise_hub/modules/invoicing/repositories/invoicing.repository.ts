import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { InvoiceEntity } from '../entities/invoice.entity';

/**
 * لایه Repository - تنها نقطه دسترسی به پایگاه‌داده برای ماژول Invoicing.
 * Controller/Service هرگز نباید مستقیماً به TypeORM Repository دسترسی داشته باشند
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Injectable()
export class InvoicingRepository {
  constructor(
    @InjectRepository(InvoiceEntity)
    private readonly repository: Repository<InvoiceEntity>,
  ) {}

  async create(data: Partial<InvoiceEntity>): Promise<InvoiceEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async save(entity: InvoiceEntity): Promise<InvoiceEntity> {
    return this.repository.save(entity);
  }

  async findById(id: string): Promise<InvoiceEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByTaxInvoiceNumber(
    taxInvoiceNumber: string,
  ): Promise<InvoiceEntity | null> {
    return this.repository.findOne({ where: { taxInvoiceNumber } });
  }

  async findAndCount(
    options: FindManyOptions<InvoiceEntity>,
  ): Promise<[InvoiceEntity[], number]> {
    return this.repository.findAndCount(options);
  }
}
