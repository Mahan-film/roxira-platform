import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { InquiryStatus } from '../enums/inquiry-status.enum';

/**
 * درخواست سازمانی (پیش‌ثبت‌نام / درخواست همکاری) — جدول `enterprise_inquiries`.
 *
 * هر رکورد یک درخواست ثبت‌شده از فرم عمومی پورتال است. ستون `tenant_id`
 * به‌عنوان ستون مالکیت (Rule #4 - AGENTS.md) اضافه شده و برای درخواست‌های
 * عمومی مقدار NULL دارد (NULL = درخواست عمومی/بدون مستأجر).
 *
 * تنها از طریق InquiriesRepository قابل دسترسی است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'enterprise_inquiries' })
export class EnterpriseInquiryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string | null;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  company: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  source: string | null;

  @Index()
  @Column({
    type: 'varchar',
    length: 20,
    default: InquiryStatus.NEW,
  })
  status: InquiryStatus;

  @Index()
  @Column({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
