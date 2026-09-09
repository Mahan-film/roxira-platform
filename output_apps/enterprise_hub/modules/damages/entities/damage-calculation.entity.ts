import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DamageCalculationMethod } from '../enums/calculation-method.enum';

/**
 * موجودیت پایگاه‌داده برای رکورد محاسبه خسارت تاخیر تادیه.
 * فقط از طریق DamagesRepository قابل دسترسی است (Rule #3 - AGENTS.md).
 */
@Entity({ name: 'damage_calculations' })
export class DamageCalculationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  principalAmount: number;

  @Column({ type: 'date' })
  dueDate: string;

  @Column({ type: 'date' })
  paymentDate: string;

  @Column({ type: 'enum', enum: DamageCalculationMethod })
  calculationMethod: DamageCalculationMethod;

  @Column({ type: 'int' })
  delayedDays: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  damageAmount: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  totalPayable: number;

  @Column({ type: 'varchar', length: 512 })
  legalBasis: string;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  contractReferenceNumber?: string;

  @CreateDateColumn()
  createdAt: Date;
}
