import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Per-party data encryption key (DEK) for crypto-shredding. Destroying a row in this table
 * renders the party's `pii_ciphertext` permanently undecryptable while leaving party IDs and
 * immutable ledger/audit hash chains intact.
 */
@Entity({ name: 'erp_party_keys' })
@Index('UQ_erp_party_keys_tenant_party', ['tenantId', 'partyId'], { unique: true })
export class PartyKeyEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'party_id' })
  partyId: number;

  @Column({ type: 'text', name: 'dek_b64' })
  dekB64: string;

  @Column({ type: 'integer', name: 'key_version', default: 1 })
  keyVersion: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
