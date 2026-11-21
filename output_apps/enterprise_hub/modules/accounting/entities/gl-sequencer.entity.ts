import { Column, Entity, PrimaryColumn } from 'typeorm';

export const GL_CHAIN_GENESIS_HASH = '0'.repeat(64);

/** Per-entity sequencer state for gapless GL audit numbers and SHA-256 chain head (T178). */
@Entity({ name: 'fin_gl_sequencers' })
export class GlSequencerEntity {
  @PrimaryColumn({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'bigint', name: 'last_audit_number', default: 0 })
  lastAuditNumber: string;

  @Column({ type: 'varchar', length: 64, name: 'head_hash', default: GL_CHAIN_GENESIS_HASH })
  headHash: string;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt: Date;
}
