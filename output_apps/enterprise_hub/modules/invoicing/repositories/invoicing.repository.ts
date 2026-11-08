import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindManyOptions,
  FindOptionsWhere,
  In,
  Repository,
} from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { InvoiceEntity } from '../entities/invoice.entity';
import { InvoiceDirection, InvoiceSubject } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';

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
  private resolvedScope?: TenantScope | null;

  constructor(
    @InjectRepository(InvoiceEntity)
    private readonly repository: Repository<InvoiceEntity>,
    private readonly dataSource: DataSource,
    @Optional() private readonly scope?: TenantScope,
  ) {}

  private getScope(): TenantScope | null {
    if (this.resolvedScope !== undefined) return this.resolvedScope;
    if (this.scope) return (this.resolvedScope = this.scope);
    if (this.dataSource && typeof this.dataSource.transaction === 'function') {
      return (this.resolvedScope = new TenantScope(this.dataSource));
    }
    const conn = this.repository?.manager?.connection;
    if (conn && typeof conn.transaction === 'function') {
      return (this.resolvedScope = new TenantScope(conn));
    }
    return (this.resolvedScope = null);
  }

  private withRepo<T>(
    tenantId: string,
    manager: EntityManager | undefined,
    work: (repo: Repository<InvoiceEntity>, m?: EntityManager) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    if (!scope) {
      const repo = manager ? manager.getRepository(InvoiceEntity) : this.repository;
      return work(repo, manager);
    }
    return scope.within(tenantId, manager, (m) => work(m.getRepository(InvoiceEntity), m));
  }

  /** Runs `work` in one database transaction (bound to `tenantId` when provided). */
  transaction<T>(work: (manager: EntityManager) => Promise<T>, tenantId?: string): Promise<T> {
    const scope = this.getScope();
    if (tenantId && scope) {
      return scope.run(tenantId, work);
    }
    return this.dataSource.transaction(work);
  }

  /**
   * Loads the invoice with a row lock (`SELECT ... FOR UPDATE`) inside the caller's transaction.
   * A concurrent posting of the same invoice waits here and then sees the committed posting
   * columns, so stock and ledger are never posted twice.
   */
  async findByIdForPosting(
    tenantId: string,
    id: string,
    manager: EntityManager,
  ): Promise<InvoiceEntity | null> {
    return this.withRepo(tenantId, manager, (repo) =>
      repo.findOne({
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      }),
    );
  }

  /**
   * Serialises returns of one sale: `FOR NO KEY UPDATE` on the sale row inside the caller's
   * transaction. A second return of the same sale waits here until the first has committed, so its
   * remaining-quantity check sees it. The weaker mode (not FOR UPDATE) does not conflict with the
   * foreign-key share lock the return's own insert takes on the sale row.
   */
  async lockForReturn(tenantId: string, id: string, manager: EntityManager): Promise<InvoiceEntity | null> {
    return this.withRepo(tenantId, manager, (repo) =>
      repo.findOne({
        where: { id, tenantId },
        lock: { mode: 'for_no_key_update' },
      }),
    );
  }

  async create(
    tenantId: string,
    data: Partial<InvoiceEntity>,
    manager?: EntityManager,
  ): Promise<InvoiceEntity> {
    return this.withRepo(tenantId, manager, async (repo) => {
      const entity = repo.create({ ...data, tenantId });
      return repo.save(entity);
    });
  }

  async save(
    tenantId: string,
    entity: InvoiceEntity,
  ): Promise<InvoiceEntity> {
    return this.withRepo(tenantId, undefined, async (repo) => {
      // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
      await repo.update(
        { id: entity.id, tenantId },
        {
          taxInvoiceNumber: entity.taxInvoiceNumber,
          customerId: entity.customerId,
          sellerInfo: entity.sellerInfo,
          buyerInfo: entity.buyerInfo,
          items: entity.items,
          currency: entity.currency,
          jurisdiction: entity.jurisdiction,
          exchangeRate: entity.exchangeRate,
          fxRate: entity.fxRate,
          amountFx: entity.amountFx,
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
          warehouseId: entity.warehouseId ?? null,
        },
      );
      entity.tenantId = tenantId;
      return entity;
    });
  }

  async findById(tenantId: string, id: string): Promise<InvoiceEntity | null> {
    return this.withRepo(tenantId, undefined, (repo) => repo.findOne({ where: { id, tenantId } }));
  }

  /**
   * به‌روزرسانی فقط ستون‌های ثبت رویدادها (سند حسابداری/خطا) با قید مستأجر.
   *
   * این متد عمداً جدا از `save` است تا هنگام ثبت ناهمزمان رویداد، سایر فیلدهای
   * صورتحساب بازنویسی نشوند و نوشتن همیشه فقط روی ردیف همان سازمان اثر بگذارد
   * (Rule #4 - AGENTS.md: جداسازی مستأجر).
   */
  async updatePosting(
    tenantId: string,
    id: string,
    data: Partial<
      Pick<
        InvoiceEntity,
        | 'journalEntryId'
        | 'paidJournalEntryId'
        | 'reversalJournalEntryId'
        | 'postingError'
        | 'postingMeta'
      >
    >,
    manager?: EntityManager,
  ): Promise<void> {
    await this.withRepo(tenantId, manager, async (repo) => {
      await repo.update({ id, tenantId }, data);
    });
  }

  /** The invoice a POS retry refers to (same tenant, same client key). */
  async findByIdempotencyKey(tenantId: string, key: string): Promise<InvoiceEntity | null> {
    return this.withRepo(tenantId, undefined, (repo) => repo.findOne({ where: { tenantId, idempotencyKey: key } }));
  }

  /** Every document that refers to `relatedId` (corrective, cancel, return), oldest first. */
  async findByRelated(
    tenantId: string,
    relatedId: string,
  ): Promise<InvoiceEntity[]> {
    return this.withRepo(tenantId, undefined, (repo) =>
      repo.find({
        where: { tenantId, relatedInvoiceId: relatedId },
        order: { createdAt: 'ASC' },
      }),
    );
  }

  /** Corrective documents of `relatedId`, oldest first (inside the caller's transaction). */
  async findCorrectives(
    tenantId: string,
    relatedId: string,
    manager: EntityManager,
  ): Promise<InvoiceEntity[]> {
    return this.withRepo(tenantId, manager, (repo) =>
      repo.find({
        where: {
          tenantId,
          relatedInvoiceId: relatedId,
          subject: InvoiceSubject.CORRECTIVE,
        },
        order: { createdAt: 'ASC' },
      }),
    );
  }

  async findByTaxInvoiceNumber(
    tenantId: string,
    taxInvoiceNumber: string,
  ): Promise<InvoiceEntity | null> {
    return this.withRepo(tenantId, undefined, (repo) =>
      repo.findOne({
        where: { taxInvoiceNumber, tenantId },
      }),
    );
  }

  /** حذف گروهی صورتحساب‌های یک دسته ورود داده با قید مستأجر (برای undo). */
  async deleteByIds(tenantId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    return this.withRepo(tenantId, undefined, async (repo) => {
      const result = await repo.delete({ tenantId, id: In(ids) });
      return result.affected ?? 0;
    });
  }

  /**
   * Issued and paid invoices of the tenant for report queries. `from` and `to` are Tehran days
   * (YYYY-MM-DD), both inclusive; the period is by issue date.
   */
  async findDocsBetween(
    tenantId: string,
    direction: InvoiceDirection,
    from?: string,
    to?: string,
  ): Promise<InvoiceEntity[]> {
    return this.withRepo(tenantId, undefined, (repo) => {
      const query = repo
        .createQueryBuilder('invoice')
        .where('invoice.tenantId = :tenantId', { tenantId })
        .andWhere('invoice.direction = :direction', { direction })
        .andWhere('invoice.status IN (:...statuses)', { statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PAID] });
      if (from) {
        query.andWhere('invoice.issuedAt >= :from', { from: new Date(`${from}T00:00:00+03:30`) });
      }
      if (to) {
        const next = new Date(`${to}T00:00:00+03:30`);
        next.setUTCDate(next.getUTCDate() + 1);
        query.andWhere('invoice.issuedAt < :next', { next });
      }
      return query.orderBy('invoice.issuedAt', 'ASC').addOrderBy('invoice.id', 'ASC').getMany();
    });
  }

  /**
   * Issued and paid sale invoices of the tenant for the sales report. `from` and `to` are Tehran days
   * (YYYY-MM-DD), both inclusive; the period is by issue date.
   */
  async findSalesBetween(tenantId: string, from?: string, to?: string): Promise<InvoiceEntity[]> {
    return this.findDocsBetween(tenantId, InvoiceDirection.SALE, from, to);
  }

  async findAndCount(
    tenantId: string,
    options: FindManyOptions<InvoiceEntity>,
  ): Promise<[InvoiceEntity[], number]> {
    const where = (options.where ?? {}) as FindOptionsWhere<InvoiceEntity>;
    return this.withRepo(tenantId, undefined, (repo) =>
      repo.findAndCount({
        ...options,
        where: { ...where, tenantId },
      }),
    );
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
      direction?: InvoiceEntity['direction'];
      skip: number;
      take: number;
    },
  ): Promise<[InvoiceEntity[], number]> {
    return this.withRepo(tenantId, undefined, (repo) => {
      const query = repo
        .createQueryBuilder('invoice')
        .where('invoice.tenantId = :tenantId', { tenantId });

      if (options.search) {
        const pattern = `%${options.search}%`;
        query.andWhere(
          "(invoice.taxInvoiceNumber ILIKE :pattern OR invoice.buyerInfo ->> 'name' ILIKE :pattern OR invoice.sellerInfo ->> 'name' ILIKE :pattern)",
          { pattern },
        );
      }
      if (options.status) {
        query.andWhere('invoice.status = :status', { status: options.status });
      }
      if (options.direction) {
        query.andWhere('invoice.direction = :direction', {
          direction: options.direction,
        });
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
    });
  }

  /**
   * جمع مبالغ صورتحساب‌های یک مستأجر به تفکیک ارز و وضعیت (فقط خواندنی).
   *
   * تاریخ مبنا زمان صدور است و برای پیش‌نویس‌ها زمان ایجاد. همه فیلترها با
   * پارامتر bind می‌شوند و قید `tenantId` همیشه اعمال می‌شود (Rule #4).
   */
  async summarize(
    tenantId: string,
    options: {
      statuses: InvoiceEntity['status'][];
      from?: Date;
      to?: Date;
      buyerSearch?: string;
    },
  ): Promise<InvoiceSummaryRow[]> {
    return this.withRepo(tenantId, undefined, async (repo) => {
      const query = repo
        .createQueryBuilder('invoice')
        .select('invoice.currency', 'currency')
        .addSelect('invoice.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(invoice.finalPayable), 0)', 'total')
        .addSelect('COALESCE(SUM(invoice.totalTax), 0)', 'tax')
        .where('invoice.tenantId = :tenantId', { tenantId })
        .andWhere("invoice.direction = 'SALE'")
        .andWhere('invoice.subject <> 3')
        .andWhere('invoice.status IN (:...statuses)', {
          statuses: options.statuses,
        });

      if (options.from) {
        query.andWhere('COALESCE(invoice.issuedAt, invoice.createdAt) >= :from', {
          from: options.from,
        });
      }
      if (options.to) {
        query.andWhere('COALESCE(invoice.issuedAt, invoice.createdAt) < :to', {
          to: options.to,
        });
      }
      if (options.buyerSearch) {
        query.andWhere("invoice.buyerInfo ->> 'name' ILIKE :buyer", {
          buyer: `%${options.buyerSearch.replace(/[\\%_]/g, '\\$&')}%`,
        });
      }

      const rows = await query
        .groupBy('invoice.currency')
        .addGroupBy('invoice.status')
        .getRawMany<{
          currency: string;
          status: InvoiceEntity['status'];
          count: string;
          total: string;
          tax: string;
        }>();

      return rows.map((row) => ({
        currency: row.currency as InvoiceEntity['currency'],
        status: row.status,
        count: Number(row.count),
        total: Number(row.total),
        tax: Number(row.tax),
      }));
    });
  }
}

/** یک ردیف خلاصه صورتحساب‌ها (به تفکیک ارز و وضعیت). */
export interface InvoiceSummaryRow {
  currency: InvoiceEntity['currency'];
  status: InvoiceEntity['status'];
  count: number;
  total: number;
  tax: number;
}
