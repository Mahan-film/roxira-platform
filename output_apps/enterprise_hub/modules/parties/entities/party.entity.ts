import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { PartyRole } from '../enums/party-role.enum';

/**
 * A party (طرف حساب) of the tenant: customer, supplier or both, keyed by a per-tenant code.
 * The code is the join key used by treasury documents, invoices and ledger lines.
 */
@Entity({ name: 'erp_parties' })
@Index('UQ_erp_parties_tenant_code', ['tenantId', 'code'], { unique: true })
@Index('IDX_erp_parties_tenant_role_active', ['tenantId', 'role', 'active'])
export class PartyEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  role: PartyRole;

  @Column({ type: 'varchar', length: 20, name: 'national_id', nullable: true })
  nationalId: string | null;

  @Column({ type: 'varchar', length: 20, name: 'economic_code', nullable: true })
  economicCode: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 254, nullable: true })
  email: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
