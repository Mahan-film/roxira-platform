import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BankCode } from '../enums/banking.enum';

/**
 * حساب بانکی سازمان (Bank account) که به یک حساب دفتر کل متصل است.
 *
 * هر سطر صورتحساب بانک به یکی از این حساب‌ها تعلق دارد و تطبیق بانکی با
 * سطرهای دفتر همان حساب دفتر کل (`ledger_account_id`) انجام می‌شود.
 */
@Entity({ name: 'fin_bank_accounts' })
@Index('IDX_fin_bank_accounts_tenant_number', ['tenantId', 'accountNumber'], {
  unique: true,
})
export class BankAccountEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** شناسه سازمان مالک (تنها از توکن تأییدشده JWT). */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32, name: 'bank_code', default: BankCode.OTHER })
  bankCode: BankCode;

  @Column({ type: 'varchar', length: 64, name: 'account_number' })
  accountNumber: string;

  /** شماره شبا (IR + ۲۴ رقم). */
  @Column({ type: 'varchar', length: 34, nullable: true })
  iban: string | null;

  /** حساب دفتر کل متناظر (fin_chart_of_accounts.id همین مستأجر). */
  @Column({ type: 'integer', name: 'ledger_account_id' })
  ledgerAccountId: number;

  @Column({ type: 'varchar', length: 8, default: 'IRR' })
  currency: string;

  /** مانده بانک پیش از نخستین سطر واردشده (وقتی صورتحساب ستون مانده ندارد). */
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'opening_balance',
    default: 0,
  })
  openingBalance: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
