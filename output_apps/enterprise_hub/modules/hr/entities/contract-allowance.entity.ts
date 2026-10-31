import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AllowanceTaxTreatment } from '../enums/hr.enum';
import { numericTransformer } from './numeric-column.transformer';

/** A recurring monthly allowance on a contract, beyond the statutory ones. */
@Entity({ name: 'hr_contract_allowances' })
export class ContractAllowanceEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'integer', name: 'contract_id' })
  contractId: number;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ type: 'boolean', default: true })
  insurable: boolean;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'tax_treatment',
    default: AllowanceTaxTreatment.PROGRESSIVE,
  })
  taxTreatment: AllowanceTaxTreatment;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
