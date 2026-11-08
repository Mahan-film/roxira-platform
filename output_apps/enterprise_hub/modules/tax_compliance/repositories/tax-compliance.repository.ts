import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, FindOptionsWhere, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { TaxInvoiceSignatureEntity } from '../entities/tax-invoice-signature.entity';
import { TaxSigningKeyEntity } from '../entities/tax-signing-key.entity';

/**
 * لایه Repository ماژول «تطبیق سامانه مودیان».
 *
 * تنها نقطه دسترسی مستقیم به جداول `tax_signing_keys` و
 * `tax_invoice_signatures` است؛ Controller و Service هرگز مستقیماً به
 * TypeORM دسترسی ندارند (Rule #3 - AGENTS.md: Repository Pattern).
 *
 * همه متدها `tenantId` را به‌عنوان پارامتر اول می‌گیرند و هر خواندن/نوشتن را به
 * همان مستأجر محدود می‌کنند تا هیچ داده‌ای از سازمان دیگر خوانده یا تغییر نکند
 * (Rule #4 - AGENTS.md: جداسازی مستأجر در لایه Repository).
 */
@Injectable()
export class TaxComplianceRepository {
  private resolvedScope?: TenantScope | null;

  constructor(
    @InjectRepository(TaxSigningKeyEntity)
    private readonly signingKeyRepository: Repository<TaxSigningKeyEntity>,
    @InjectRepository(TaxInvoiceSignatureEntity)
    private readonly signatureRepository: Repository<TaxInvoiceSignatureEntity>,
    @Optional() private readonly scope?: TenantScope,
  ) {}

  private getScope(): TenantScope | null {
    if (this.resolvedScope !== undefined) return this.resolvedScope;
    if (this.scope) return (this.resolvedScope = this.scope);
    const conn =
      this.signingKeyRepository?.manager?.connection ??
      this.signatureRepository?.manager?.connection;
    if (conn && typeof conn.transaction === 'function') {
      return (this.resolvedScope = new TenantScope(conn));
    }
    return (this.resolvedScope = null);
  }

  private withKeys<T>(
    tenantId: string,
    work: (repo: Repository<TaxSigningKeyEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    if (!scope) return work(this.signingKeyRepository);
    return scope.run(tenantId, (m) => work(m.getRepository(TaxSigningKeyEntity)));
  }

  private withSignatures<T>(
    tenantId: string,
    work: (repo: Repository<TaxInvoiceSignatureEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    if (!scope) return work(this.signatureRepository);
    return scope.run(tenantId, (m) => work(m.getRepository(TaxInvoiceSignatureEntity)));
  }

  // ---------------------------------------------------------------------------
  // کلیدهای امضا
  // ---------------------------------------------------------------------------

  async createKey(
    tenantId: string,
    data: Partial<TaxSigningKeyEntity>,
  ): Promise<TaxSigningKeyEntity> {
    return this.withKeys(tenantId, async (repo) => {
      const entity = repo.create({ ...data, tenantId });
      return repo.save(entity);
    });
  }

  async saveKey(
    tenantId: string,
    entity: TaxSigningKeyEntity,
  ): Promise<TaxSigningKeyEntity> {
    return this.withKeys(tenantId, async (repo) => {
      // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
      await repo.update(
        { id: entity.id, tenantId },
        {
          certificateRequestPem: entity.certificateRequestPem,
          isActive: entity.isActive,
        },
      );
      entity.tenantId = tenantId;
      return entity;
    });
  }

  /** آخرین کلید فعال سازمان (بدون کلید خصوصی). */
  async findActiveKey(tenantId: string): Promise<TaxSigningKeyEntity | null> {
    return this.withKeys(tenantId, (repo) =>
      repo.findOne({
        where: { tenantId, isActive: true },
        order: { createdAt: 'DESC' },
      }),
    );
  }

  /** آخرین کلید فعال سازمان به‌همراه کلید خصوصی برای عملیات امضا. */
  async findActiveKeyWithPrivate(
    tenantId: string,
  ): Promise<TaxSigningKeyEntity | null> {
    return this.withKeys(tenantId, (repo) =>
      repo
        .createQueryBuilder('key')
        .addSelect('key.privateKeyPem')
        .where('key.isActive = :isActive', { isActive: true })
        .andWhere('key.tenantId = :tenantId', { tenantId })
        .orderBy('key.createdAt', 'DESC')
        .getOne(),
    );
  }

  /** یافتن کلید سازمان بر اساس شناسه یکتا (برای راستی‌آزمایی امضاها). */
  async findKeyById(
    tenantId: string,
    keyId: string,
  ): Promise<TaxSigningKeyEntity | null> {
    return this.withKeys(tenantId, (repo) => repo.findOne({ where: { tenantId, keyId } }));
  }

  /** غیرفعال‌سازی کلیدهای فعال «فقط همان سازمان» پیش از فعال‌سازی کلید جدید. */
  async deactivateAllKeys(tenantId: string): Promise<void> {
    await this.withKeys(tenantId, async (repo) => {
      await repo.update({ tenantId, isActive: true }, { isActive: false });
    });
  }

  // ---------------------------------------------------------------------------
  // بسته‌های امضاشده
  // ---------------------------------------------------------------------------

  async createSignature(
    tenantId: string,
    data: Partial<TaxInvoiceSignatureEntity>,
  ): Promise<TaxInvoiceSignatureEntity> {
    return this.withSignatures(tenantId, async (repo) => {
      const entity = repo.create({ ...data, tenantId });
      return repo.save(entity);
    });
  }

  async saveSignature(
    tenantId: string,
    entity: TaxInvoiceSignatureEntity,
  ): Promise<TaxInvoiceSignatureEntity> {
    return this.withSignatures(tenantId, async (repo) => {
      // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
      await repo.update(
        { id: entity.id, tenantId },
        {
          status: entity.status,
          referenceNumber: entity.referenceNumber,
          errorMessage: entity.errorMessage,
        },
      );
      entity.tenantId = tenantId;
      return entity;
    });
  }

  async findSignatureById(
    tenantId: string,
    id: string,
  ): Promise<TaxInvoiceSignatureEntity | null> {
    return this.withSignatures(tenantId, (repo) => repo.findOne({ where: { id, tenantId } }));
  }

  async findSignatureByInvoiceId(
    tenantId: string,
    invoiceId: string,
  ): Promise<TaxInvoiceSignatureEntity | null> {
    return this.withSignatures(tenantId, (repo) =>
      repo.findOne({
        where: { tenantId, invoiceId },
      }),
    );
  }

  async findSignaturesAndCount(
    tenantId: string,
    options: FindManyOptions<TaxInvoiceSignatureEntity>,
  ): Promise<[TaxInvoiceSignatureEntity[], number]> {
    const where = (options.where ?? {}) as FindOptionsWhere<TaxInvoiceSignatureEntity>;
    return this.withSignatures(tenantId, (repo) =>
      repo.findAndCount({
        ...options,
        where: { ...where, tenantId },
      }),
    );
  }
}
