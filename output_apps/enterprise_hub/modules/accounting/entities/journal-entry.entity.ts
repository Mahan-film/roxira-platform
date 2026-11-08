import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { JournalEntryStatus, JournalEntryType } from '../enums/accounting.enum';
import { JournalEntryLineEntity } from './journal-entry-line.entity';

/**
 * سرصفحه سند دفتر روزنامه (General Journal Entry).
 *
 * نگاشت مستقیم به جدول موجود `fin_journal_entries`. سطرهای بدهکار/بستانکار
 * در جدول `fin_journal_entry_lines` نگهداری می‌شوند و رابطه OneToMany
 * با cascade برقرار است.
 */
@Entity({ name: 'fin_journal_entries' })
@Index('IDX_fin_journal_entries_tenant_entry_number', [
  'tenantId',
  'entryNumber',
], {
  unique: true,
})
@Index('IDX_fin_journal_entries_tenant_date', ['tenantId', 'date'])
export class JournalEntryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** شناسه سازمان مالک سند (تنها از توکن تأییدشده JWT). */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64, name: 'entry_number' })
  entryNumber: string;

  /**
   * «شمارهٔ قطعی» — assigned once by the database when the voucher first becomes POSTED, per tenant
   * and fiscal year. NULL while the voucher is not final. Never changes afterwards. `pg` returns
   * bigint as a string, so the API exposes it as a string too.
   */
  @Column({ type: 'bigint', name: 'permanent_number', nullable: true })
  permanentNumber: string | null;

  /** The fiscal year the permanent number belongs to; 0 when no fiscal year covers the date. */
  @Column({ type: 'integer', name: 'permanent_fiscal_year_id', nullable: true })
  permanentFiscalYearId: number | null;

  @Column({ type: 'varchar', length: 128, name: 'idempotency_key', nullable: true })
  idempotencyKey: string | null;

  @Index()
  @Column({ type: 'timestamp' })
  date: Date;

  @Column({ type: 'text' })
  description: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 20,
    default: JournalEntryStatus.POSTED,
  })
  status: JournalEntryStatus;

  /** Set on a reversing entry: the posted entry it reverses (unique per tenant). */
  @Column({ type: 'integer', name: 'reverses_entry_id', nullable: true })
  reversesEntryId: number | null;

  /**
   * Optimistic edit lock. Incremented by every content/status update through a guarded UPDATE
   * (`WHERE ... AND version = expected`), so a stale form is refused with 409 instead of
   * silently overwriting the other user's save.
   */
  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'entry_type',
    default: JournalEntryType.NORMAL,
  })
  entryType: JournalEntryType;

  @OneToMany(() => JournalEntryLineEntity, (line) => line.journalEntry, {
    cascade: true,
  })
  lines: JournalEntryLineEntity[];
}