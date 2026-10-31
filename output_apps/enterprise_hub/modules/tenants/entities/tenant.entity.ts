import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * موجودیت سازمان (مستأجر) — نگاشت مستقیم به جدول `tenants`.
 *
 * هر سازمان یک فضای داده‌ای جداگانه است و کاربران با `users.tenant_id` به آن
 * متصل می‌شوند. کاربر بدون سازمان (مثلاً کاربر قاضی هوشمند) مستأجر NULL دارد.
 *
 * دسترسی مستقیم به این موجودیت فقط از طریق TenantsRepository مجاز است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'tenants' })
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80 })
  slug: string;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  /** نرخ پیش‌فرض VAT سازمان به‌صورت نسبت (۰٫۱ = ۱۰٪). */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 4,
    name: 'default_vat_rate',
    default: 0.1,
    transformer: {
      to: (value: number) => value,
      from: (value: string | null) => (value === null ? 0.1 : Number(value)),
    },
  })
  defaultVatRate: number;

  /** When true, members must sign in with a second factor (TOTP or passkey) to use the suite. */
  @Column({ type: 'boolean', default: false, name: 'require_2fa' })
  require2fa: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
