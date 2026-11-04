import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** A tenant's account for one posting role of one document type ("*" = every document type). */
@Entity({ name: 'fin_posting_role_maps' })
@Index('UQ_fin_posting_role_maps', ['tenantId', 'docType', 'role'], { unique: true })
export class PostingRoleMapEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 48, name: 'doc_type' })
  docType: string;

  @Column({ type: 'varchar', length: 48 })
  role: string;

  @Column({ type: 'varchar', length: 32, name: 'account_code' })
  accountCode: string;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
