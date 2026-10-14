import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { JournalEntryStatus } from '../enums/accounting.enum';
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

  @OneToMany(() => JournalEntryLineEntity, (line) => line.journalEntry, {
    cascade: true,
  })
  lines: JournalEntryLineEntity[];
}