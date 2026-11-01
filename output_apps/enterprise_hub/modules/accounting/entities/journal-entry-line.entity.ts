import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChartOfAccountEntity } from './chart-of-account.entity';
import { JournalEntryEntity } from './journal-entry.entity';

/**
 * سطر بدهکار/بستانکار یک سند دفتر روزنامه (Double-Entry Line).
 *
 * هر سند حسابداری دوطرفه از حداقل دو سطر تشکیل می‌شود؛ جمع بدهکار تمام سطرها
 * باید با جمع بستانکار آن‌ها برابر باشد. نگاشت به جدول `fin_journal_entry_lines`
 * که از طریق Migration ایجاد می‌گردد.
 */
@Entity({ name: 'fin_journal_entry_lines' })
@Index('IDX_fin_journal_entry_lines_tenant_account', ['tenantId', 'accountId'])
@Index('IDX_fin_journal_entry_lines_tenant_entry', [
  'tenantId',
  'journalEntryId',
])
export class JournalEntryLineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** شناسه سازمان مالک سطر (denormalised برای فیلتر بدون join). */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Index()
  @Column({ type: 'integer', name: 'journal_entry_id' })
  journalEntryId: number;

  @ManyToOne(() => JournalEntryEntity, (entry) => entry.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntryEntity;

  @Index()
  @Column({ type: 'integer', name: 'account_id' })
  accountId: number;

  @ManyToOne(() => ChartOfAccountEntity, (account) => account.lines, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'account_id' })
  account: ChartOfAccountEntity;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  debit: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  credit: string;

  /**
   * ارز سطر (کد متعارف: IRR/IRT/USD/…). مبالغ بدهکار/بستانکار همیشه بر مبنای
   * ریال (ارز گزارش‌گیری) نگهداری می‌شوند و این ستون ارز مبدأ را ثبت می‌کند.
   */
  @Column({ type: 'varchar', length: 8, default: 'IRR' })
  currency: string;

  /** مبلغ به ارز مبدأ (اختیاری) — برای ردیابی اسناد چندارزی. */
  @Column({
    type: 'numeric',
    precision: 24,
    scale: 6,
    name: 'amount_fx',
    nullable: true,
  })
  amountFx: string | null;

  /** نرخ تبدیل ارز مبدأ به ریال (اختیاری). */
  @Column({
    type: 'numeric',
    precision: 24,
    scale: 6,
    name: 'fx_rate',
    nullable: true,
  })
  fxRate: string | null;

  /** کد طرف حساب/تفضیلی (party reference) — ارجاع بدون کلید خارجی. */
  @Column({
    type: 'varchar',
    length: 64,
    name: 'party_code',
    nullable: true,
  })
  partyCode: string | null;

  /** Floating detail account, cost centre and project centre (fin_dimensions ids), all optional. */
  @Column({ type: 'integer', name: 'detail_id', nullable: true })
  detailId: number | null;

  @Column({ type: 'integer', name: 'cost_center_id', nullable: true })
  costCenterId: number | null;

  @Column({ type: 'integer', name: 'project_id', nullable: true })
  projectId: number | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}