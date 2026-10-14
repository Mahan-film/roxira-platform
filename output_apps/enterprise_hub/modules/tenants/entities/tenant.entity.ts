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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
