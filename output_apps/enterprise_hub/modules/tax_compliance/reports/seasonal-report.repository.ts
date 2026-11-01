import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { InvoiceJurisdiction } from '../../invoicing/enums/invoice-jurisdiction.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';

/**
 * Read-only access to issued invoices for seasonal reports. Every query is
 * scoped by `tenantId` taken from the verified JWT (AGENTS.md hard rule).
 */
@Injectable()
export class SeasonalReportRepository {
  constructor(
    @InjectRepository(InvoiceEntity)
    private readonly invoices: Repository<InvoiceEntity>,
  ) {}

  /** Domestic (IR) invoices issued in `[from, to)`: ISSUED and PAID only. */
  async findIssuedBetween(tenantId: string, from: Date, to: Date): Promise<InvoiceEntity[]> {
    return this.invoices
      .createQueryBuilder('invoice')
      .where('invoice.tenantId = :tenantId', { tenantId })
      .andWhere('invoice.status IN (:...statuses)', {
        statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PAID],
      })
      // Sales VAT counts our original sales only: purchases are a different return, and
      // cancel documents repeat the invoice they cancel.
      .andWhere("invoice.direction = 'SALE'")
      .andWhere('invoice.subject = 1')
      .andWhere('invoice.jurisdiction = :jurisdiction', { jurisdiction: InvoiceJurisdiction.IR })
      .andWhere('invoice.issuedAt >= :from', { from })
      .andWhere('invoice.issuedAt < :to', { to })
      .orderBy('invoice.issuedAt', 'ASC')
      .addOrderBy('invoice.taxInvoiceNumber', 'ASC')
      .getMany();
  }
}
