import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { TaxInvoiceSignatureEntity } from '../entities/tax-invoice-signature.entity';
import { TaxSigningKeyEntity } from '../entities/tax-signing-key.entity';

/**
 * لایه Repository ماژول «تطبیق سامانه مودیان».
 *
 * تنها نقطه دسترسی مستقیم به جداول `tax_signing_keys` و
 * `tax_invoice_signatures` است؛ Controller و Service هرگز مستقیماً به
 * TypeORM دسترسی ندارند (Rule #3 - AGENTS.md: Repository Pattern).
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

  async createKey(data: Partial<TaxSigningKeyEntity>): Promise<TaxSigningKeyEntity> {
    const entity = this.signingKeyRepository.create(data);
    return this.signingKeyRepository.save(entity);
  }

  async saveKey(entity: TaxSigningKeyEntity): Promise<TaxSigningKeyEntity> {
    return this.signingKeyRepository.save(entity);
  }

  /** آخرین کلید فعال سازمان (بدون کلید خصوصی). */
  async findActiveKey(): Promise<TaxSigningKeyEntity | null> {
    return this.signingKeyRepository.findOne({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  /** آخرین کلید فعال به‌همراه کلید خصوصی برای عملیات امضا. */
  async findActiveKeyWithPrivate(): Promise<TaxSigningKeyEntity | null> {
    return this.signingKeyRepository
      .createQueryBuilder('key')
      .addSelect('key.privateKeyPem')
      .where('key.isActive = :isActive', { isActive: true })
      .orderBy('key.createdAt', 'DESC')
      .getOne();
  }

  /** یافتن کلید بر اساس شناسه یکتا (برای راستی‌آزمایی امضاها). */
  async findKeyById(keyId: string): Promise<TaxSigningKeyEntity | null> {
    return this.signingKeyRepository.findOne({ where: { keyId } });
  }

  /** غیرفعال‌سازی تمام کلیدها پیش از فعال‌سازی کلید جدید. */
  async deactivateAllKeys(): Promise<void> {
    await this.signingKeyRepository.update({ isActive: true }, { isActive: false });
  }

  // ---------------------------------------------------------------------------
  // بسته‌های امضاشده
  // ---------------------------------------------------------------------------

  async createSignature(
    data: Partial<TaxInvoiceSignatureEntity>,
  ): Promise<TaxInvoiceSignatureEntity> {
    const entity = this.signatureRepository.create(data);
    return this.signatureRepository.save(entity);
  }

  async saveSignature(
    entity: TaxInvoiceSignatureEntity,
  ): Promise<TaxInvoiceSignatureEntity> {
    return this.signatureRepository.save(entity);
  }

  async findSignatureById(id: string): Promise<TaxInvoiceSignatureEntity | null> {
    return this.signatureRepository.findOne({ where: { id } });
  }

  async findSignatureByInvoiceId(
    invoiceId: string,
  ): Promise<TaxInvoiceSignatureEntity | null> {
    return this.signatureRepository.findOne({ where: { invoiceId } });
  }

  async findSignaturesAndCount(
    options: FindManyOptions<TaxInvoiceSignatureEntity>,
  ): Promise<[TaxInvoiceSignatureEntity[], number]> {
    return this.signatureRepository.findAndCount(options);
  }
}
