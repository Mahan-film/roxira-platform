import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TaxSubmissionStatus } from '../enums/tax-compliance.enum';

/**
 * بسته امضاشده مالیاتی هر صورتحساب.
 *
 * هر صورتحساب صادرشده دقیقاً یک بسته امضاشده دارد که شامل شناسه یکتای
 * مالیاتی ۲۲ رقمی (TaxID)، هش داده صورتحساب، امضای دیجیتال JWS و بسته
 * کامل ارسالی به سامانه مودیان است. `invoiceId` به‌صورت یکتا ایندکس می‌شود
 * تا از امضای دوباره یک صورتحساب جلوگیری شود.
 *
 * تنها از طریق TaxComplianceRepository قابل دسترسی است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'tax_invoice_signatures' })
export class TaxInvoiceSignatureEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId: string;

  @Index()
  @Column({ type: 'varchar', length: 64, name: 'tax_invoice_number' })
  taxInvoiceNumber: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, name: 'tax_id' })
  taxId: string;

  @Column({ type: 'varchar', length: 16, name: 'hash_algorithm' })
  hashAlgorithm: string;

  @Column({ type: 'varchar', length: 128, name: 'data_hash' })
  dataHash: string;

  @Column({ type: 'varchar', length: 16, name: 'signature_algorithm' })
  signatureAlgorithm: string;

  @Column({ type: 'text', name: 'jws_signature' })
  jwsSignature: string;

  @Index()
  @Column({ type: 'varchar', length: 96, name: 'key_id' })
  keyId: string;

  @Column({ type: 'varchar', length: 128, name: 'key_fingerprint' })
  keyFingerprint: string;

  @Index()
  @Column({
    type: 'enum',
    enum: TaxSubmissionStatus,
    default: TaxSubmissionStatus.SIGNED,
  })
  status: TaxSubmissionStatus;

  @Column({ type: 'varchar', length: 64, name: 'reference_number', nullable: true })
  referenceNumber: string | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', name: 'signed_packet' })
  signedPacket: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
