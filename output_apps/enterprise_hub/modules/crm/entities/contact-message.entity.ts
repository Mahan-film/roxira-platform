import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ContactChannel } from '../enums/crm.enums';

/**
 * سابقه تماس / پیام مرتبط با سرنخ — نگاشت مستقیم به جدول موجود
 * `contact_messages`.
 *
 * این جدول هم پیام‌های فرم تماس عمومی سایت را نگه می‌دارد و هم سوابق تماس
 * مرتبط با یک سرنخ مشخص (`leadId`). برای سوابق CRM، `leadId` مقدار دارد و
 * `channel` نوع تعامل (تلفن، رایانامه، جلسه و ...) را مشخص می‌کند.
 *
 * تنها از طریق CrmRepository قابل دسترسی است
 * (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Entity({ name: 'contact_messages' })
export class ContactMessageEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 100, name: 'sender_name' })
  senderName: string;

  @Column({ type: 'varchar', length: 50, name: 'sender_phone' })
  senderPhone: string;

  @Column({ type: 'varchar', length: 100, name: 'sender_email', nullable: true })
  senderEmail: string | null;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ type: 'text' })
  message: string;

  @Index()
  @Column({ type: 'integer', name: 'lead_id', nullable: true })
  leadId: number | null;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    default: ContactChannel.PHONE,
  })
  channel: ContactChannel | null;

  @Index()
  @Column({
    type: 'timestamp',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;
}
