import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A fixed asset and the running totals of its depreciation. */
@Entity({ name: 'fin_fixed_assets' })
@Index('UQ_fin_fixed_assets_tenant_code', ['tenantId', 'code'], { unique: true })
export class FixedAssetEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  category: string;

  @Column({ type: 'date', name: 'acquisition_date' })
  acquisitionDate: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  cost: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'salvage_value', default: 0 })
  salvageValue: string;

  @Column({ type: 'varchar', length: 20 })
  method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE';

  @Column({ type: 'integer', name: 'life_months', nullable: true })
  lifeMonths: number | null;

  @Column({ type: 'numeric', precision: 8, scale: 6, name: 'annual_rate', nullable: true })
  annualRate: string | null;

  /** Where the rate comes from (law article, tax circular); the accountant fills it in. */
  @Column({ type: 'text', name: 'rate_source', nullable: true })
  rateSource: string | null;

  @Column({ type: 'boolean', name: 'rate_verified', default: false })
  rateVerified: boolean;

  @Column({ type: 'varchar', length: 32, name: 'asset_account_code' })
  assetAccountCode: string;

  @Column({ type: 'varchar', length: 32, name: 'accumulated_account_code' })
  accumulatedAccountCode: string;

  @Column({ type: 'varchar', length: 32, name: 'expense_account_code' })
  expenseAccountCode: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'accumulated_depreciation', default: 0 })
  accumulatedDepreciation: string;

  @Column({ type: 'integer', name: 'months_depreciated', default: 0 })
  monthsDepreciated: number;

  /** Jalali year * 12 + month - 1 of the next month to charge; months cannot be skipped. */
  @Column({ type: 'integer', name: 'next_period_index' })
  nextPeriodIndex: number;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: 'ACTIVE' | 'FULLY_DEPRECIATED' | 'DISPOSED';

  @Column({ type: 'date', name: 'disposal_date', nullable: true })
  disposalDate: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'disposal_proceeds', nullable: true })
  disposalProceeds: string | null;

  @Column({ type: 'integer', name: 'disposal_journal_entry_id', nullable: true })
  disposalJournalEntryId: number | null;

  @Column({ type: 'varchar', length: 64, name: 'created_by' })
  createdBy: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}

/** One asset-month of depreciation and the journal entry that booked it. */
@Entity({ name: 'fin_depreciation_lines' })
@Index('UQ_fin_depreciation_lines_month', ['tenantId', 'assetId', 'periodYear', 'periodMonth'], { unique: true })
export class DepreciationLineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'asset_id' })
  assetId: number;

  @Column({ type: 'integer', name: 'period_year' })
  periodYear: number;

  @Column({ type: 'integer', name: 'period_month' })
  periodMonth: number;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({ type: 'integer', name: 'journal_entry_id' })
  journalEntryId: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
