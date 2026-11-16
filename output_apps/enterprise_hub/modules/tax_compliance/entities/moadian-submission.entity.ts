import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MoadianSubmissionStatus } from '../enums/moadian.enum';

export interface MoadianMessage {
  code: string;
  message: string;
}

/**
 * وضعیت ارسال هر صورتحساب به سامانه مودیان (یک ردیف برای هر صورتحساب در
 * هر مستأجر). `packet` بستهٔ امضانشده (برای ممیزی) است؛ JWS/JWE ذخیره نمی‌شود.
 */
@Entity({ name: 'moadian_submissions' })
@Index('IDX_moadian_submissions_tenant_invoice_ins', ['tenantId', 'invoiceId', 'ins'], { unique: true })
@Index('IDX_moadian_submissions_tenant_root', ['tenantId', 'rootInvoiceId'])
@Index('IDX_moadian_submissions_tenant_status', ['tenantId', 'status'])
@Index('IDX_moadian_submissions_tenant_tax_id', ['tenantId', 'taxId'], { unique: true })
export class MoadianSubmissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId: string;

  /** requestTraceId / uid ارسالی به مودیان. */
  @Column({ type: 'uuid', name: 'uid' })
  uid: string;

  @Column({ type: 'varchar', length: 22, name: 'tax_id' })
  taxId: string;

  @Column({ type: 'bigint', name: 'serial' })
  serial: string;

  @Column({ type: 'varchar', length: 64, name: 'reference_number', nullable: true })
  referenceNumber: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: MoadianSubmissionStatus.QUEUED,
  })
  status: MoadianSubmissionStatus;

  @Column({ type: 'jsonb', name: 'errors', default: () => "'[]'" })
  errors: MoadianMessage[];

  @Column({ type: 'jsonb', name: 'warnings', default: () => "'[]'" })
  warnings: MoadianMessage[];

  @Column({ type: 'integer', name: 'poll_count', default: 0 })
  pollCount: number;

  @Column({ type: 'timestamp', name: 'sent_at', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamp', name: 'last_polled_at', nullable: true })
  lastPolledAt: Date | null;

  @Column({ type: 'jsonb', name: 'packet' })
  packet: Record<string, unknown>;

  /** موضوع صورتحساب (ins): ۱ اصلی، ۲ اصلاحی، ۳ ابطالی، ۴ برگشتی. */
  @Column({ type: 'smallint', name: 'ins', default: 1 })
  ins: number;

  /** صورتحساب اصلیِ زنجیره (برای اصلی = خودش). null در ردیف‌های قدیمی. */
  @Column({ type: 'uuid', name: 'root_invoice_id', nullable: true })
  rootInvoiceId: string | null;

  /** irtaxid استفاده‌شده در بسته (آخرین taxid تأییدشده زنجیره هنگام صف‌شدن). */
  @Column({ type: 'varchar', length: 22, name: 'reference_tax_id', nullable: true })
  referenceTaxId: string | null;

  /** فقط روی ردیف اصلی: taxid مرجع فعلی زنجیره؛ با تأیید هر اصلاحی/برگشتی جلو می‌رود. */
  @Column({ type: 'varchar', length: 22, name: 'active_reference_tax_id', nullable: true })
  activeReferenceTaxId: string | null;

  @Column({ type: 'uuid', name: 'profile_id', nullable: true })
  profileId: string | null;

  /** تعداد دفعاتی که ارسال شبکه‌ای شروع شده است (پیش از تماس ثبت می‌شود). */
  @Column({ type: 'integer', name: 'attempt_count', default: 0 })
  attemptCount: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
