import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PipelineStage } from '../enums/crm.enums';

/**
 * سرنخ فروش سازمانی (CRM Lead) — نگاشت مستقیم به جدول موجود `crm_leads`.
 *
 * هر سرنخ یک فرصت فروش بالقوه است که در پایپ‌لاین حرکت می‌کند. `pipelineStage`
 * مرحله فعلی و `estimatedValue` ارزش ریالی برآوردی معامله است؛ مجموع ارزش
 * مراحل باز، «درآمد بالقوه» سازمان را می‌سازد.
 *
 * ستون‌های numeric درایور Postgres به‌صورت رشته برمی‌گردند؛ Transformer آن‌ها
 * را به عدد تبدیل می‌کند تا محاسبات تحلیلی دقیق بماند.
 *
 * تنها از طریق CrmRepository قابل دسترسی است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'crm_leads' })
@Index('IDX_crm_leads_tenant_email', ['tenantId', 'email'], { unique: true })
export class CrmLeadEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Index()
  @Column({ type: 'varchar', length: 120, name: 'full_name' })
  fullName: string;

  /** Optional: a customer known only by phone (POS) has none. Unique per tenant when present. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  company: string | null;

  /** Digits-only form of `phone` used for exact matching (see `normalizePhone`). */
  @Column({ type: 'varchar', length: 24, name: 'phone_normalized', nullable: true })
  phoneNormalized: string | null;

  /** The built-in anonymous customer that receives sales with no customer details. One per tenant. */
  @Column({ type: 'boolean', name: 'is_walk_in', default: false })
  isWalkIn: boolean;

  /** A sale never implies consent to marketing. */
  @Column({ type: 'boolean', name: 'marketing_consent', default: false })
  marketingConsent: boolean;

  /** Where the record came from, e.g. POS. */
  @Column({ type: 'varchar', length: 24, nullable: true })
  source: string | null;

  @Index()
  @Column({
    type: 'varchar',
    length: 50,
    name: 'pipeline_stage',
    default: PipelineStage.NEW,
  })
  pipelineStage: PipelineStage;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'estimated_value',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string | null) => (value === null ? 0 : Number(value)),
    },
  })
  estimatedValue: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  owner: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Index()
  @Column({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @Column({
    type: 'timestamp',
    name: 'updated_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
