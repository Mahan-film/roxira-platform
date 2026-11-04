import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ChequeDirection, ChequeStatus } from '../enums/cheque.enum';
import { SayadRegistrationStatus } from '../sayad/sayad';

/**
 * Received or issued cheque. Amounts are in IRR. The Sayad number is entered by
 * the user; there is no live Sayad integration, so `sayad_verified` only records
 * what the user declared.
 */
@Entity({ name: 'fin_cheques' })
@Index('IDX_fin_cheques_tenant_due', ['tenantId', 'status', 'dueDate'])
export class ChequeEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 16 })
  direction: ChequeDirection;

  @Column({ type: 'varchar', length: 16, name: 'sayad_number', nullable: true })
  sayadNumber: string | null;

  @Column({ type: 'boolean', name: 'sayad_verified', default: false })
  sayadVerified: boolean;

  /** Declared by the user, never read from Sayad. */
  @Column({ type: 'varchar', length: 16, name: 'sayad_registration_status', default: SayadRegistrationStatus.UNKNOWN })
  sayadRegistrationStatus: SayadRegistrationStatus;

  /** Who ticked `sayadVerified` and when; both null while it is false. */
  @Column({ type: 'varchar', length: 128, name: 'sayad_verified_by', nullable: true })
  sayadVerifiedBy: string | null;

  @Column({ type: 'timestamp', name: 'sayad_verified_at', nullable: true })
  sayadVerifiedAt: Date | null;

  /** National id of the payee named in the Sayad registration: 10 digits (person) or 11 (company). */
  @Column({ type: 'varchar', length: 11, name: 'receiver_national_id', nullable: true })
  receiverNationalId: string | null;

  @Column({ type: 'varchar', length: 32, name: 'cheque_number' })
  chequeNumber: string;

  @Column({ type: 'varchar', length: 64, name: 'bank_name', nullable: true })
  bankName: string | null;

  /** numeric(18,2) as the exact decimal string pg returns; convert with `fromDb`, never Number(). */
  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({ type: 'date', name: 'issue_date' })
  issueDate: string;

  @Column({ type: 'date', name: 'due_date' })
  dueDate: string;

  /** Drawer (received) or payee (issued). */
  @Column({ type: 'varchar', length: 128, name: 'party_name' })
  partyName: string;

  @Column({ type: 'varchar', length: 64, name: 'party_code', nullable: true })
  partyCode: string | null;

  /** Third party the cheque was endorsed to (status SPENT). */
  @Column({ type: 'varchar', length: 128, name: 'spent_to_name', nullable: true })
  spentToName: string | null;

  @Column({ type: 'varchar', length: 64, name: 'spent_to_code', nullable: true })
  spentToCode: string | null;

  @Column({ type: 'varchar', length: 11, name: 'spent_to_national_id', nullable: true })
  spentToNationalId: string | null;

  /** Part already paid by the bank (partial payment); 0 until then. numeric(18,2) string like `amount`. */
  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'settled_amount', default: '0' })
  settledAmount: string;

  @Column({ type: 'varchar', length: 16, default: ChequeStatus.REGISTERED })
  status: ChequeStatus;

  @Column({ type: 'varchar', length: 512, nullable: true })
  description: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
