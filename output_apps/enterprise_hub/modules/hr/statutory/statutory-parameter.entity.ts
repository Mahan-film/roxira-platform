import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum StatutorySourceKind {
  /** Copied from an official text kept in docs/legal_sources. */
  OFFICIAL = 'OFFICIAL',
  /** From a research report; not an official text. */
  REPORT = 'REPORT',
  /** Carried over from the old hardcoded payroll rates. */
  LEGACY = 'LEGACY',
  /** Entered by an organisation's owner or admin. */
  TENANT = 'TENANT',
}

/**
 * One version of one statutory value. `tenantId` null is the platform default; an organisation's
 * edit is a new row carrying its own tenant id. Rows are append-only (database trigger).
 */
@Entity({ name: 'statutory_parameters' })
export class StatutoryParameterEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string | null;

  @Column({ type: 'varchar', length: 2 })
  country: string;

  @Column({ type: 'integer', name: 'fiscal_year' })
  fiscalYear: number;

  @Column({ type: 'varchar', length: 64, name: 'param_key' })
  paramKey: string;

  /** Gregorian ISO date. */
  @Column({ type: 'date', name: 'effective_from' })
  effectiveFrom: string;

  @Column({ type: 'integer', default: 1 })
  version: number;

  /** number (rials, counts), decimal string (rates) or bracket list; see statutory-catalogue.ts. */
  @Column({ type: 'jsonb' })
  value: unknown;

  @Column({ type: 'text' })
  source: string;

  @Column({ type: 'varchar', length: 16, name: 'source_kind' })
  sourceKind: StatutorySourceKind;

  @Column({ type: 'boolean', default: false })
  verified: boolean;

  @Column({ type: 'varchar', length: 64, name: 'created_by' })
  createdBy: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
