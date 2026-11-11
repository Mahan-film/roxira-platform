import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * صندوق‌های نقدی سازمان (Task T54 / #230).
 */
@Entity({ name: 'fin_cash_boxes' })
@Index('UQ_fin_cash_boxes_tenant_code', ['tenantId', 'code'], { unique: true })
export class CashBoxEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  /** حساب دفتر کل متناظر معین یا تفصیلی صندوق در fin_chart_of_accounts */
  @Column({ type: 'integer', name: 'ledger_account_id' })
  ledgerAccountId: number;

  @Column({ type: 'varchar', length: 8, default: 'IRR' })
  currency: string;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    name: 'opening_balance',
  })
  openingBalance: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
