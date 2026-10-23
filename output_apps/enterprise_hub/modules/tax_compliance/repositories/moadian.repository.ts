import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MoadianCredentialEntity } from '../entities/moadian-credential.entity';
import { MoadianSubmissionEntity } from '../entities/moadian-submission.entity';

/**
 * تنها لایهٔ دسترسی به `moadian_credentials` و `moadian_submissions`.
 *
 * همه متدها `tenantId` را به‌عنوان پارامتر اول می‌گیرند و هر خواندن/نوشتن را به
 * همان مستأجر محدود می‌کنند (Rule #4 - AGENTS.md). `tenantId` همیشه از claim
 * تأییدشدهٔ JWT یا از payload صفی که خود سرویس ساخته می‌آید، نه از کلاینت.
 */
@Injectable()
export class MoadianRepository {
  constructor(
    @InjectRepository(MoadianCredentialEntity)
    private readonly credentials: Repository<MoadianCredentialEntity>,
    @InjectRepository(MoadianSubmissionEntity)
    private readonly submissions: Repository<MoadianSubmissionEntity>,
  ) {}

  // ---------------------------------------------------------------------------
  // اطلاعات اتصال
  // ---------------------------------------------------------------------------

  async findCredential(tenantId: string): Promise<MoadianCredentialEntity | null> {
    return this.credentials.findOne({ where: { tenantId } });
  }

  async findCredentialWithPrivateKey(
    tenantId: string,
  ): Promise<MoadianCredentialEntity | null> {
    return this.credentials
      .createQueryBuilder('c')
      .addSelect('c.privateKeySealed')
      .where('c.tenantId = :tenantId', { tenantId })
      .getOne();
  }

  /** ایجاد یا جایگزینی اطلاعات اتصال همان مستأجر؛ شمارنده سریال حفظ می‌شود. */
  async upsertCredential(
    tenantId: string,
    data: Omit<
      Partial<MoadianCredentialEntity>,
      'id' | 'tenantId' | 'nextSerial' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<MoadianCredentialEntity> {
    const existing = await this.findCredential(tenantId);
    if (existing) {
      await this.credentials.update({ id: existing.id, tenantId }, data);
      return (await this.findCredential(tenantId)) as MoadianCredentialEntity;
    }
    return this.credentials.save(this.credentials.create({ ...data, tenantId }));
  }

  /** رزرو اتمیک سریال بعدی صورتحساب برای همان مستأجر. */
  async reserveSerial(tenantId: string): Promise<number> {
    const result = await this.credentials
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
  }

  // ---------------------------------------------------------------------------
  // وضعیت ارسال صورتحساب
  // ---------------------------------------------------------------------------

  async findSubmissionByInvoice(
    tenantId: string,
    invoiceId: string,
  ): Promise<MoadianSubmissionEntity | null> {
    return this.submissions.findOne({ where: { tenantId, invoiceId } });
  }

  async findSubmissionById(
    tenantId: string,
    id: string,
  ): Promise<MoadianSubmissionEntity | null> {
    return this.submissions.findOne({ where: { tenantId, id } });
  }

  async createSubmission(
    tenantId: string,
    data: Partial<MoadianSubmissionEntity>,
  ): Promise<MoadianSubmissionEntity> {
    return this.submissions.save(this.submissions.create({ ...data, tenantId }));
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
    await this.submissions.update({ id, tenantId }, safe as never);
    return this.findSubmissionById(tenantId, id);
  }
}
