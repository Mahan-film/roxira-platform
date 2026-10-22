import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * فعالیت CRM (فعالیت سرنخ/طرف حساب) — مقصد ورود بستهٔ دیتابیس.
 *
 * این جدول مکمل `crm_leads` است: پیگیری‌ها/تماس‌هایی که در بستهٔ نرم‌افزار
 * قبلی به‌صورت جدول «فعالیت‌های سرنخ» وجود دارند و با کد تفصیلی طرف حساب
 * (`party_code`) به مشتری/طرف حساب اشاره می‌کنند.
 */
@Entity({ name: 'crm_activities' })
@Index('IDX_crm_activities_tenant_party', ['tenantId', 'partyCode'])
export class CrmActivityEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 100, name: 'party_code', nullable: true })
  partyCode: string | null;

  @Column({ type: 'varchar', length: 20, name: 'activity_date', nullable: true })
  activityDate: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  owner: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  channel: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  stage: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  currency: string | null;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  amount: number | null;

  @Column({ type: 'integer', nullable: true })
  probability: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
