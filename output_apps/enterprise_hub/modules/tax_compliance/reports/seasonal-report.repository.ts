import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { InvoiceJurisdiction } from '../../invoicing/enums/invoice-jurisdiction.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import { CaptureDocumentEntity } from '../../invoice_capture/entities/capture.entities';

/**
 * Read-only access to issued invoices for seasonal reports. Every query is
 * scoped by `tenantId` taken from the verified JWT (AGENTS.md hard rule).
 */
@Injectable()
export class SeasonalReportRepository {
  private resolvedScope?: TenantScope | null;

  constructor(
    @InjectRepository(InvoiceEntity)
    private readonly invoices: Repository<InvoiceEntity>,
    @InjectRepository(CaptureDocumentEntity)
    private readonly captures: Repository<CaptureDocumentEntity>,
    @Optional() private readonly scope?: TenantScope,
  ) {}

  private getScope(): TenantScope | null {
    if (this.resolvedScope !== undefined) return this.resolvedScope;
    if (this.scope) return (this.resolvedScope = this.scope);
    const conn = this.invoices?.manager?.connection ?? this.captures?.manager?.connection;
    if (conn && typeof conn.transaction === 'function') {
      return (this.resolvedScope = new TenantScope(conn));
    }
    return (this.resolvedScope = null);
  }

  private withInvoices<T>(
    tenantId: string,
    work: (repo: Repository<InvoiceEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    if (!scope) return work(this.invoices);
    return scope.run(tenantId, (m) => work(m.getRepository(InvoiceEntity)));
  }

  private withCaptures<T>(
    tenantId: string,
    work: (repo: Repository<CaptureDocumentEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    if (!scope) return work(this.captures);
    return scope.run(tenantId, (m) => work(m.getRepository(CaptureDocumentEntity)));
  }

  /**
   * Returns (subject 4) and correctives (subject 2) of either direction issued in `[from, to)`.
   * The ledger books them on the VAT accounts, so the VAT return must account for them.
   */
  async findAdjustmentsBetween(tenantId: string, from: Date, to: Date): Promise<InvoiceEntity[]> {
    return this.withInvoices(tenantId, (repo) =>
      repo
        .createQueryBuilder('invoice')
        .where('invoice.tenantId = :tenantId', { tenantId })
        .andWhere('invoice.status IN (:...statuses)', {
          statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PAID],
        })
        .andWhere('invoice.subject IN (2, 4)')
        .andWhere('invoice.jurisdiction = :jurisdiction', { jurisdiction: InvoiceJurisdiction.IR })
        .andWhere('invoice.issuedAt >= :from', { from })
        .andWhere('invoice.issuedAt < :to', { to })
        .getMany(),
    );
  }

  /** Purchase invoices (direction PURCHASE, original subject) issued in `[from, to)`. */
  async findPurchaseInvoicesBetween(tenantId: string, from: Date, to: Date): Promise<InvoiceEntity[]> {
    return this.withInvoices(tenantId, (repo) =>
      repo
        .createQueryBuilder('invoice')
        .where('invoice.tenantId = :tenantId', { tenantId })
        .andWhere('invoice.status IN (:...statuses)', {
          statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PAID],
        })
        .andWhere("invoice.direction = 'PURCHASE'")
        .andWhere('invoice.subject = 1')
        .andWhere('invoice.jurisdiction = :jurisdiction', { jurisdiction: InvoiceJurisdiction.IR })
        .andWhere('invoice.issuedAt >= :from', { from })
        .andWhere('invoice.issuedAt < :to', { to })
        .orderBy('invoice.issuedAt', 'ASC')
        .addOrderBy('invoice.taxInvoiceNumber', 'ASC')
        .getMany(),
    );
  }

  /**
   * Posted purchase captures dated in `[fromDay, toDay)` (Gregorian `YYYY-MM-DD`, Tehran days).
   * Reversed and rejected documents are excluded: only `posted` and `auto_posted` count.
   */
  async findPostedCapturePurchasesBetween(
    tenantId: string,
    fromDay: string,
    toDay: string,
  ): Promise<CaptureDocumentEntity[]> {
    const draftField = (key: string): string =>
      `COALESCE(doc.edited ->> '${key}', doc.extracted -> 'draft' ->> '${key}')`;
    return this.withCaptures(tenantId, (repo) =>
      repo
        .createQueryBuilder('doc')
        .where('doc.tenantId = :tenantId', { tenantId })
        .andWhere("doc.status IN ('posted', 'auto_posted')")
        .andWhere(`${draftField('kind')} = 'purchase'`)
        .andWhere(`${draftField('date')} >= :fromDay`, { fromDay })
        .andWhere(`${draftField('date')} < :toDay`, { toDay })
        .orderBy('doc.createdAt', 'ASC')
        .getMany(),
    );
  }

  /** Domestic (IR) invoices issued in `[from, to)`: ISSUED and PAID only. */
  async findIssuedBetween(tenantId: string, from: Date, to: Date): Promise<InvoiceEntity[]> {
    return this.withInvoices(tenantId, (repo) =>
      repo
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
        .getMany(),
    );
  }
}
