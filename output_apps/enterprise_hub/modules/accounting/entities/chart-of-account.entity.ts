import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { AccountType } from '../enums/accounting.enum';
import { JournalEntryLineEntity } from './journal-entry-line.entity';

/**
 * حساب دفتر کل (Chart of Accounts).
 *
 * این موجودیت مستقیماً به جدول موجود `fin_chart_of_accounts` متصل است که
 * توسط سیستم مالی پایتونی (AI/Enterprise Core) نیز استفاده می‌شود. ساختار
 * ستون‌ها بدون هیچ Migration تخریبی نگاشت شده است (Rule #4 AGENTS.md).
 */
@Entity({ name: 'fin_chart_of_accounts' })
@Index('IDX_fin_chart_of_accounts_tenant_code', ['tenantId', 'code'], {
  unique: true,
})
export class ChartOfAccountEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** شناسه سازمان مالک حساب (تنها از توکن تأییدشده JWT). */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Index()
  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({
    type: 'enum',
    enum: AccountType,
    enumName: 'accounttype',
    name: 'account_type',
  })
  accountType: AccountType;

  /** ISO code, IRT (toman) or MULTI for multi-currency accounts. */
  @Column({ type: 'varchar', length: 8, default: 'IRR' })
  currency: string;

  /**
   * مانده حساب با علامت بدهکار-مثبت (debit-positive).
   * در سرویس به‌صورت اتمیک همراه با ثبت هر سند دوطرفه به‌روزرسانی می‌شود.
   */
  @Column({ type: 'double precision', default: 0 })
  balance: number;

  @OneToMany(() => JournalEntryLineEntity, (line) => line.account)
  lines: JournalEntryLineEntity[];
}