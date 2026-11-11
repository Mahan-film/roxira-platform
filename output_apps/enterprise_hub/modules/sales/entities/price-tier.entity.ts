import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CustomerGroup } from '../../parties/enums/customer-group.enum';

const bigintMinor = {
  to: (value: bigint | number): string => {
    if (value === null || value === undefined) {
      throw new Error('Price tier unitPrice cannot be null or undefined');
    }
    return String(value);
  },
  from: (value: string | null): bigint => {
    if (value === null || value === undefined) {
      throw new Error('Price tier unitPrice in database cannot be null');
    }
    return BigInt(value);
  },
};

/**
 * Price lists per customer group (consumer, wholesale, partner) (#230 / T74).
 * Chosen automatically on sales quotes and invoices based on party customer group.
 */
@Entity({ name: 'erp_price_tiers' })
@Index('IDX_erp_price_tiers_lookup', ['tenantId', 'sku', 'customerGroup'])
export class PriceTierEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'varchar', length: 32, name: 'customer_group' })
  customerGroup: CustomerGroup;

  /** Unit price in minor currency units (Rials), mapped as BigInt */
  @Column({
    type: 'bigint',
    name: 'unit_price',
    transformer: bigintMinor,
  })
  unitPrice: bigint;

  /** Optional discount % applied to this tier (0.00 to 100.00) */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'discount_percent',
    default: 0,
    transformer: {
      to: (v: number) => v,
      from: (v: string | null) => (v === null ? 0 : Number(v)),
    },
  })
  discountPercent: number;

  @Column({ type: 'date', name: 'effective_from', default: () => 'CURRENT_DATE' })
  effectiveFrom: string;

  @Column({ type: 'date', name: 'effective_to', nullable: true })
  effectiveTo: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
