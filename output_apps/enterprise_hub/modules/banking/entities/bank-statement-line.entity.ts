import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MatchMethod } from '../enums/banking.enum';

/**
 * سطر صورتحساب بانک (Bank statement line) واردشده از اکسل/CSV بانک.
 *
 * مبالغ از دید بانک ثبت می‌شوند: `withdrawal` (برداشت/بدهکار) و `deposit`
 * (واریز/بستانکار). در دفاتر شرکت، واریز با «بدهکار» حساب بانک و برداشت با
 * «بستانکار» آن متناظر است. سطر «تطبیق‌خورده» است اگر و فقط اگر
 * `matched_journal_line_id` پر باشد؛ ایندکس یکتای جزئی تضمین می‌کند هر سطر دفتر
 * فقط با یک سطر بانک تطبیق بخورد.
 */
@Entity({ name: 'fin_bank_statement_lines' })
@Index('IDX_fin_bank_statement_lines_tenant_account_date', [
  'tenantId',
  'bankAccountId',
  'txnDate',
])
@Index('IDX_fin_bank_statement_lines_tenant_dedupe', ['tenantId', 'dedupeKey'])
export class BankStatementLineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'bank_account_id' })
  bankAccountId: number;

  /** تاریخ تراکنش (میلادی، `YYYY-MM-DD`). */
  @Column({ type: 'date', name: 'txn_date' })
  txnDate: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  withdrawal: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  deposit: number;

  /** مانده پس از تراکنش طبق بانک (اختیاری). */
  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  balance: number | null;

  /** شماره پیگیری/مرجع/سند بانک. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  reference: string | null;

  /** کلید تشخیص تکراری هنگام ورود دوباره همان صورتحساب. */
  @Column({ type: 'varchar', length: 255, name: 'dedupe_key' })
  dedupeKey: string;

  @Column({ type: 'integer', name: 'matched_journal_line_id', nullable: true })
  matchedJournalLineId: number | null;

  @Column({ type: 'varchar', length: 16, name: 'match_method', nullable: true })
  matchMethod: MatchMethod | null;

  @Column({ type: 'timestamp', name: 'matched_at', nullable: true })
  matchedAt: Date | null;

  /** سندی که از همین سطر ساخته شد (اختیاری). */
  @Column({ type: 'integer', name: 'created_journal_entry_id', nullable: true })
  createdJournalEntryId: number | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
