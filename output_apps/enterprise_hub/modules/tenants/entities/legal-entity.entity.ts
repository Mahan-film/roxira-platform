import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Legal entity belonging to a tenant (T224). Holds per-entity tax, VAT, and e-invoicing
 * registration IDs so multi-entity / VAT-group tenants never rely solely on tenant-level IDs.
 */
@Entity({ name: 'legal_entities' })
@Index('UQ_legal_entities_tenant_code', ['tenantId', 'code'], { unique: true })
export class LegalEntityEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 2, name: 'country_code', default: 'IR' })
  countryCode: string;

  /** Member's own VAT registration / TRN. */
  @Column({ type: 'varchar', length: 32, name: 'vat_id', nullable: true })
  vatId: string | null;

  /** Member's own TIN / economic code / national tax ID. */
  @Column({ type: 'varchar', length: 32, name: 'tax_id', nullable: true })
  taxId: string | null;

  /** Member's own e-invoicing participant / fiscal ID (never a UAE VAT group TIN). */
  @Column({ type: 'varchar', length: 64, name: 'einvoice_id', nullable: true })
  einvoiceId: string | null;

  /** Optional VAT group TIN (for group VAT returns only; refused for UAE e-invoicing). */
  @Column({ type: 'varchar', length: 32, name: 'vat_group_tin', nullable: true })
  vatGroupTin: string | null;

  @Column({ type: 'boolean', name: 'is_default', default: false })
  isDefault: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
