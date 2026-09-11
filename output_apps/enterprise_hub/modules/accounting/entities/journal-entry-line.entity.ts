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
export class JournalEntryLineEntity {
  @PrimaryGeneratedColumn()
  id: number;

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
  debit: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  credit: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}