import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TaxTransmissionEnvironment, TaxTransmissionMode } from '../enums/tax-transmission.enum';

/**
 * One row per fiscal memory (memory id) of a tenant. A tenant may have several.
 *
 * `moadian_credentials` stays the single place for key material and the serial counter (one row per
 * tenant); it cannot hold several memory ids, so the per-memory routing (mode, environment, TSP)
 * lives here and holds no secret. Access only through FiscalMemoryProfileRepository.
 */
@Entity({ name: 'fiscal_memory_profiles' })
@Index('IDX_fiscal_memory_profiles_tenant_memory_env', ['tenantId', 'memoryId', 'environment'], {
  unique: true,
})
export class FiscalMemoryProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 6, name: 'memory_id' })
  memoryId: string;

  @Column({ type: 'varchar', length: 24 })
  mode: TaxTransmissionMode;

  @Column({ type: 'varchar', length: 16 })
  environment: TaxTransmissionEnvironment;

  /** Code of the TSP; set exactly when mode is a tsp_* mode. */
  @Column({ type: 'varchar', length: 64, name: 'tsp_provider', nullable: true })
  tspProvider: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
