import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { MoadianCredentialEntity } from '../entities/moadian-credential.entity';
import { MoadianSubmissionEntity } from '../entities/moadian-submission.entity';
import { MoadianSubmissionStatus } from '../enums/moadian.enum';

/**
 * تنها لایهٔ دسترسی به `moadian_credentials` و `moadian_submissions`.
 *
 * همه متدها `tenantId` را به‌عنوان پارامتر اول می‌گیرند و هر خواندن/نوشتن را به
 * همان مستأجر محدود می‌کنند (Rule #4 - AGENTS.md). `tenantId` همیشه از claim
 * تأییدشدهٔ JWT یا از payload صفی که خود سرویس ساخته می‌آید، نه از کلاینت.
 */
@Injectable()
export class MoadianRepository {
  private resolvedScope?: TenantScope | null;

  constructor(
    @InjectRepository(MoadianCredentialEntity)
    private readonly credentials: Repository<MoadianCredentialEntity>,
    @InjectRepository(MoadianSubmissionEntity)
    private readonly submissions: Repository<MoadianSubmissionEntity>,
    @Optional() private readonly scope?: TenantScope,
  ) {}

  private getScope(): TenantScope | null {
    if (this.resolvedScope !== undefined) return this.resolvedScope;
    if (this.scope) return (this.resolvedScope = this.scope);
    const conn = this.credentials?.manager?.connection ?? this.submissions?.manager?.connection;
    if (conn && typeof conn.transaction === 'function') {
      return (this.resolvedScope = new TenantScope(conn));
    }
    return (this.resolvedScope = null);
  }

  private withCredentials<T>(
    tenantId: string,
    work: (repo: Repository<MoadianCredentialEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    if (!scope) return work(this.credentials);
    return scope.run(tenantId, (m) => work(m.getRepository(MoadianCredentialEntity)));
  }

  private withSubmissions<T>(
    tenantId: string,
    work: (repo: Repository<MoadianSubmissionEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    if (!scope) return work(this.submissions);
    return scope.run(tenantId, (m) => work(m.getRepository(MoadianSubmissionEntity)));
  }

  // ---------------------------------------------------------------------------
  // اطلاعات اتصال
  // ---------------------------------------------------------------------------

  async findCredential(tenantId: string): Promise<MoadianCredentialEntity | null> {
    return this.withCredentials(tenantId, (repo) => repo.findOne({ where: { tenantId } }));
  }

  async findCredentialWithPrivateKey(
    tenantId: string,
  ): Promise<MoadianCredentialEntity | null> {
    return this.withCredentials(tenantId, (repo) =>
      repo
        .createQueryBuilder('c')
        .addSelect('c.privateKeySealed')
        .where('c.tenantId = :tenantId', { tenantId })
        .getOne(),
    );
  }

  /** ایجاد یا جایگزینی اطلاعات اتصال همان مستأجر؛ شمارنده سریال حفظ می‌شود. */
  async upsertCredential(
    tenantId: string,
    data: Omit<
      Partial<MoadianCredentialEntity>,
      'id' | 'tenantId' | 'nextSerial' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<MoadianCredentialEntity> {
    return this.withCredentials(tenantId, async (repo) => {
      const existing = await repo.findOne({ where: { tenantId } });
      if (existing) {
        await repo.update({ id: existing.id, tenantId }, data);
        return (await repo.findOne({ where: { tenantId } })) as MoadianCredentialEntity;
      }
      return repo.save(repo.create({ ...data, tenantId }));
    });
  }

  /** رزرو اتمیک سریال بعدی صورتحساب برای همان مستأجر. */
  async reserveSerial(tenantId: string): Promise<number> {
    return this.withCredentials(tenantId, async (repo) => {
      const result = await repo
        .createQueryBuilder()
        .update(MoadianCredentialEntity)
        .set({ nextSerial: () => 'next_serial + 1' })
        .where('tenant_id = :tenantId', { tenantId })
        .returning('next_serial')
        .execute();
      const row = (result.raw as Array<{ next_serial: string | number }>)[0];
      if (!row) {
        throw new Error('Moadian credential not found for tenant');
      }
      return Number(row.next_serial) - 1;
    });
  }

  // ---------------------------------------------------------------------------
  // وضعیت ارسال صورتحساب
  // ---------------------------------------------------------------------------

  async findSubmissionByInvoice(
    tenantId: string,
    invoiceId: string,
  ): Promise<MoadianSubmissionEntity | null> {
    return this.withSubmissions(tenantId, (repo) =>
      repo.findOne({ where: { tenantId, invoiceId } }),
    );
  }

  async findSubmissionById(
    tenantId: string,
    id: string,
  ): Promise<MoadianSubmissionEntity | null> {
    return this.withSubmissions(tenantId, (repo) =>
      repo.findOne({ where: { tenantId, id } }),
    );
  }

  async createSubmission(
    tenantId: string,
    data: Partial<MoadianSubmissionEntity>,
  ): Promise<MoadianSubmissionEntity> {
    return this.withSubmissions(tenantId, (repo) =>
      repo.save(repo.create({ ...data, tenantId })),
    );
  }

  /** به‌روزرسانی با قید مستأجر: شناسه مستأجر دیگر ۰ ردیف را تغییر می‌دهد. */
  async updateSubmission(
    tenantId: string,
    id: string,
    patch: Partial<MoadianSubmissionEntity>,
  ): Promise<MoadianSubmissionEntity | null> {
    const { id: _id, tenantId: _tenantId, ...safe } = patch;
    void _id;
    void _tenantId;
    return this.withSubmissions(tenantId, async (repo) => {
      await repo.update({ id, tenantId }, safe as never);
      return repo.findOne({ where: { tenantId, id } });
    });
  }

  /** جدول tenants دارای RLS نیست؛ فهرست مستأجران فعال را برای کارهای دوره‌ای برمی‌گرداند. */
  async listTenantIds(): Promise<string[]> {
    const rows = await this.submissions.manager.query<Array<{ id: string }>>(
      `SELECT "id" FROM "tenants" WHERE "is_active" = true ORDER BY "id" ASC`,
    );
    return rows.map((row) => row.id);
  }

  /**
   * تمام صورتحساب‌های در وضعیت غیرنهایی (QUEUED، SENT، ERROR) برای یک مستأجر درون TenantScope،
   * به‌جز ردیف‌هایی که قبلاً به سقف استعلام (`POLL_LIMIT`) رسیده‌اند.
   */
  async findNonFinalSubmissions(
    tenantId: string,
  ): Promise<MoadianSubmissionEntity[]> {
    const nonFinalStatuses = [
      MoadianSubmissionStatus.QUEUED,
      MoadianSubmissionStatus.SENT,
      MoadianSubmissionStatus.ERROR,
    ];
    return this.withSubmissions(tenantId, (repo) =>
      repo
        .createQueryBuilder('s')
        .where('s.tenantId = :tenantId', { tenantId })
        .andWhere('s.status IN (:...statuses)', { statuses: nonFinalStatuses })
        .andWhere(`NOT (s.errors @> '[{"code":"POLL_LIMIT"}]'::jsonb)`)
        .orderBy('s.createdAt', 'ASC')
        .getMany(),
    );
  }
}
