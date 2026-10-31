import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Which modules a tenant has bought. No prices live in the platform database. */
@Entity({ name: 'tenant_module_entitlements' })
export class EntitlementEntity {
  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @PrimaryColumn({ type: 'varchar', length: 40 })
  module: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
