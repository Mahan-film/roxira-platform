import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A locked accounting period (inclusive date range) of one tenant. Rows are an audit trail and are
 * never deleted: unlocking stamps the `unlocked_*` columns, locking again inserts a new row.
 * A DB trigger enforces that history is append-only.
 */
@Entity({ name: 'fin_period_locks' })
@Index('IDX_fin_period_locks_tenant', ['tenantId', 'lockedAt'])
export class PeriodLockEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** `date` columns come back from `pg` as 'YYYY-MM-DD' strings. */
  @Column({ type: 'date', name: 'period_start' })
  periodStart: string;

  @Column({ type: 'date', name: 'period_end' })
  periodEnd: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 64, name: 'locked_by' })
  lockedBy: string;

  @Column({ type: 'timestamptz', name: 'locked_at', default: () => 'now()' })
  lockedAt: Date;

  @Column({ type: 'timestamptz', name: 'unlocked_at', nullable: true })
  unlockedAt: Date | null;

  @Column({ type: 'varchar', length: 64, name: 'unlocked_by', nullable: true })
  unlockedBy: string | null;

  @Column({ type: 'text', name: 'unlock_reason', nullable: true })
  unlockReason: string | null;
}
