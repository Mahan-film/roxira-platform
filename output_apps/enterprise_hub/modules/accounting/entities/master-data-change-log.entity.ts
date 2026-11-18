import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Immediate master-data change log (e.g. VAT codes, chart of accounts, period changes) (T178). */
@Entity({ name: 'fin_master_data_change_logs' })
@Index('IDX_fin_master_data_change_logs_tenant_entity', [
  'tenantId',
  'entityType',
  'entityId',
  'changedAt',
])
export class MasterDataChangeLogEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64, name: 'entity_type' })
  entityType: string;

  @Column({ type: 'varchar', length: 64, name: 'entity_id' })
  entityId: string;

  @Column({ type: 'varchar', length: 64, name: 'field_name' })
  fieldName: string;

  @Column({ type: 'text', name: 'old_value', nullable: true })
  oldValue: string | null;

  @Column({ type: 'text', name: 'new_value', nullable: true })
  newValue: string | null;

  @Column({ type: 'varchar', length: 64, name: 'changed_by' })
  changedBy: string;

  @Column({ type: 'timestamptz', name: 'changed_at', default: () => 'now()' })
  changedAt: Date;
}
