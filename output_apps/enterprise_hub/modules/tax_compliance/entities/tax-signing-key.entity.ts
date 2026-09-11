import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * کلید امضای مالیاتی (RSA) متعلق به سازمان مالیات‌دهنده.
 *
 * چرخه عمر کلید در سامانه مودیان به این صورت است که ابتدا یک زوج‌کلید
 * RSA تولید می‌شود، سپس درخواست امضای گواهی (CSR) برای دریافت گواهی
 * رقمی از مرجع صدور گواهی (CA) ساخته می‌شود و نهایتاً کلید خصوصی برای
 * امضای بسته صورتحساب‌ها (JWS) به کار می‌رود.
 *
 * نکته امنیتی: `privateKeyPem` هرگز در پاسخ‌های HTTP بازگردانده نمی‌شود
 * (در DTOهای خروجی فقط اطلاعات عمومی کلید منتشر می‌گردد).
 *
 * تنها از طریق TaxComplianceRepository قابل دسترسی است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'tax_signing_keys' })
export class TaxSigningKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 96, name: 'key_id' })
  keyId: string;

  @Column({ type: 'text', name: 'public_key_pem' })
  publicKeyPem: string;

  @Column({ type: 'text', name: 'private_key_pem', select: false })
  privateKeyPem: string;

  @Column({ type: 'text', name: 'certificate_request_pem', nullable: true })
  certificateRequestPem: string | null;

  @Column({ type: 'varchar', length: 16, default: 'RS256' })
  algorithm: string;

  @Column({ type: 'integer', name: 'modulus_length', default: 2048 })
  modulusLength: number;

  @Index()
  @Column({ type: 'varchar', length: 128, name: 'key_fingerprint' })
  keyFingerprint: string;

  @Index()
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
