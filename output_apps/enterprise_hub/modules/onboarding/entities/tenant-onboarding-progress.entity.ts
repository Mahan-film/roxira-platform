import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Stored form of a step: only `done` and `skipped` are written, `pending` is a missing key. */
export type StoredStepStatus = 'done' | 'skipped';

/**
 * Setup-wizard progress of one organisation (table `tenant_onboarding_progress`, FORCE RLS).
 * The primary key is the tenant id: there is at most one row per organisation.
 * Reached only through OnboardingRepository, always inside TenantScope.
 */
@Entity({ name: 'tenant_onboarding_progress' })
export class TenantOnboardingProgressEntity {
  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  steps: Record<string, StoredStepStatus>;

  @Column({ type: 'varchar', length: 14, name: 'economic_code', nullable: true })
  economicCode: string | null;

  @Column({ type: 'varchar', length: 11, name: 'national_id', nullable: true })
  nationalId: string | null;

  @Column({ type: 'boolean', default: false })
  dismissed: boolean;

  @Column({ type: 'timestamptz', name: 'first_visit_handled_at', nullable: true })
  firstVisitHandledAt: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
