import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, FindOptionsWhere, Repository } from 'typeorm';
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
  constructor(
    @InjectRepository(TaxSigningKeyEntity)
    private readonly signingKeyRepository: Repository<TaxSigningKeyEntity>,
    @InjectRepository(TaxInvoiceSignatureEntity)
    private readonly signatureRepository: Repository<TaxInvoiceSignatureEntity>,
  ) {}

  // ---------------------------------------------------------------------------
  // کلیدهای امضا
  // ---------------------------------------------------------------------------

  async createKey(
    tenantId: string,
    data: Partial<TaxSigningKeyEntity>,
  ): Promise<TaxSigningKeyEntity> {
    const entity = this.signingKeyRepository.create({ ...data, tenantId });
    return this.signingKeyRepository.save(entity);
  }

  async saveKey(
    tenantId: string,
    entity: TaxSigningKeyEntity,
  ): Promise<TaxSigningKeyEntity> {
    // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
    await this.signingKeyRepository.update(
      { id: entity.id, tenantId },
      {
        certificateRequestPem: entity.certificateRequestPem,
        isActive: entity.isActive,
      },
    );
    entity.tenantId = tenantId;
    return entity;
  }

  /** آخرین کلید فعال سازمان (بدون کلید خصوصی). */
  async findActiveKey(tenantId: string): Promise<TaxSigningKeyEntity | null> {
    return this.signingKeyRepository.findOne({
      where: { tenantId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  /** آخرین کلید فعال سازمان به‌همراه کلید خصوصی برای عملیات امضا. */
  async findActiveKeyWithPrivate(
    tenantId: string,
  ): Promise<TaxSigningKeyEntity | null> {
    return this.signingKeyRepository
      .createQueryBuilder('key')
      .addSelect('key.privateKeyPem')
      .where('key.isActive = :isActive', { isActive: true })
      .andWhere('key.tenantId = :tenantId', { tenantId })
      .orderBy('key.createdAt', 'DESC')
      .getOne();
  }

  /** یافتن کلید سازمان بر اساس شناسه یکتا (برای راستی‌آزمایی امضاها). */
  async findKeyById(
    tenantId: string,
    keyId: string,
  ): Promise<TaxSigningKeyEntity | null> {
    return this.signingKeyRepository.findOne({ where: { tenantId, keyId } });
  }

  /** غیرفعال‌سازی کلیدهای فعال «فقط همان سازمان» پیش از فعال‌سازی کلید جدید. */
  async deactivateAllKeys(tenantId: string): Promise<void> {
    await this.signingKeyRepository.update(
      { tenantId, isActive: true },
      { isActive: false },
    );
  }

  // ---------------------------------------------------------------------------
  // بسته‌های امضاشده
  // ---------------------------------------------------------------------------

  async createSignature(
    tenantId: string,
    data: Partial<TaxInvoiceSignatureEntity>,
  ): Promise<TaxInvoiceSignatureEntity> {
    const entity = this.signatureRepository.create({ ...data, tenantId });
    return this.signatureRepository.save(entity);
  }

  async saveSignature(
    tenantId: string,
    entity: TaxInvoiceSignatureEntity,
  ): Promise<TaxInvoiceSignatureEntity> {
    // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
    await this.signatureRepository.update(
      { id: entity.id, tenantId },
      {
        status: entity.status,
        referenceNumber: entity.referenceNumber,
        errorMessage: entity.errorMessage,
      },
    );
    entity.tenantId = tenantId;
    return entity;
  }

  async findSignatureById(
    tenantId: string,
    id: string,
  ): Promise<TaxInvoiceSignatureEntity | null> {
    return this.signatureRepository.findOne({ where: { id, tenantId } });
  }

  async findSignatureByInvoiceId(
    tenantId: string,
    invoiceId: string,
  ): Promise<TaxInvoiceSignatureEntity | null> {
    return this.signatureRepository.findOne({
      where: { tenantId, invoiceId },
    });
  }

  async findSignaturesAndCount(
    tenantId: string,
    options: FindManyOptions<TaxInvoiceSignatureEntity>,
  ): Promise<[TaxInvoiceSignatureEntity[], number]> {
    const where = (options.where ?? {}) as FindOptionsWhere<TaxInvoiceSignatureEntity>;
    return this.signatureRepository.findAndCount({
      ...options,
      where: { ...where, tenantId },
    });
  }
}
