import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ContractInsuranceType, ContractSide, ContractStatus } from '../enums/contracting.enum';

@Entity({ name: 'erp_contracts' })
@Index('UQ_erp_contracts_tenant_code', ['tenantId', 'code'], { unique: true })
@Index('UQ_erp_contracts_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('IDX_erp_contracts_tenant_project', ['tenantId', 'projectId'])
@Index('IDX_erp_contracts_tenant_side_status', ['tenantId', 'side', 'status'])
export class ContractEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 16 })
  side: ContractSide;

  @Column({ type: 'varchar', length: 64, name: 'party_code' })
  partyCode: string;

  @Column({ type: 'integer', name: 'project_id', nullable: true })
  projectId: number | null;

  @Column({ type: 'date', name: 'contract_date' })
  contractDate: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'advance_amount', default: '0' })
  advanceAmount: string;

  @Column({ type: 'varchar', length: 24, name: 'insurance_type', nullable: true })
  insuranceType: ContractInsuranceType | null;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: ContractStatus;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
