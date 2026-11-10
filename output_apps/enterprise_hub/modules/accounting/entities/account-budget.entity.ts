import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * سقف بودجه حساب‌ها به تفکیک سال مالی و مرکز هزینه (Task T52 / #230).
 */
@Entity({ name: 'fin_account_budgets' })
@Index('IDX_fin_account_budgets_tenant_fy', ['tenantId', 'fiscalYearId'])
export class AccountBudgetEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'fiscal_year_id' })
  fiscalYearId: number;

  @Column({ type: 'integer', name: 'cost_center_id', nullable: true })
  costCenterId: number | null;

  @Column({ type: 'varchar', length: 32, name: 'account_code' })
  accountCode: string;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    name: 'budget_amount',
  })
  budgetAmount: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
