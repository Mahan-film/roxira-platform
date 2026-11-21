import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FxRateType } from '../enums/accounting.enum';

/**
 * جدول نرخ‌های تسعیر ارز (FX Rates Table).
 *
 * کلید یکتا بر مبنای مستأجر، ارز مبدأ، ارز مقصد، تاریخ و نوع نرخ
 * (SPOT / TAX_OFFICIAL / CLOSING).
 * تحت RLS کامل، هر سازمان تنها به نرخ‌های خود دسترسی دارد.
 */
@Entity({ name: 'fx_rates' })
@Index('IDX_fx_rates_tenant_pair_date_type', [
  'tenantId',
  'baseCurrency',
  'quoteCurrency',
  'rateDate',
  'rateType',
], { unique: true })
export class FxRateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** شناسه سازمان مالک رکورد (جداسازی RLS). */
  @Index()
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  /** ارز پایه (ارز مبدأ)، مثلاً USD، EUR، MYR. */
  @Column({ type: 'varchar', length: 8, name: 'base_currency' })
  baseCurrency: string;

  /** ارز مظنه (ارز مقصد / ارز دفاتر)، مثلاً IRR. */
  @Column({ type: 'varchar', length: 8, name: 'quote_currency' })
  quoteCurrency: string;

  /** تاریخ اعمال نرخ (YYYY-MM-DD). */
  @Column({ type: 'date', name: 'rate_date' })
  rateDate: string;

  /** نوع نرخ: لحظه‌ای، رسمی مالیاتی یا پایانی دوره. */
  @Column({
    type: 'varchar',
    length: 20,
    name: 'rate_type',
  })
  rateType: FxRateType;

  /** نرخ تسعیر: واحد ارز مقصد به‌ازای ۱ واحد ارز مبدأ (دقت ۶ رقم اعشار). */
  @Column({
    type: 'numeric',
    precision: 24,
    scale: 6,
  })
  rate: string;

  /** منبع اعلام نرخ (اختیاری): مثلاً بانک مرکزی CBI، سامانه سنا، گمرک یا دستی. */
  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  source: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
