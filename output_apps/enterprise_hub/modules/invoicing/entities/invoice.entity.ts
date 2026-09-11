import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';

/**
 * اطلاعات هویتی یکی از طرفین صورتحساب (فروشنده یا خریدار).
 * به‌صورت JSONB ذخیره می‌شود تا امکان توسعه خودگردان فیلدهای مالیاتی
 * (بدون Migration ساختاری مجدد) فراهم باشد.
 */
export interface InvoicePartyInfo {
  name: string;
  nationalId?: string;
  economicCode?: string;
  registrationNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
}

/**
 * یک قلم کالا/خدمت در صورتحساب.
 * فیلدهای tax و total در سرویس به‌صورت معتبر محاسبه و جایگزین می‌شوند.
 */
export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  total: number;
}

/**
 * موجودیت پایگاه‌داده صورتحساب مالیاتی هوشمند (Smart Invoicing).
 * فقط از طریق InvoicingRepository قابل دسترسی است (Rule #3 - AGENTS.md).
 */
@Entity({ name: 'invoices' })
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  taxInvoiceNumber: string;

  @Column({ type: 'jsonb' })
  sellerInfo: InvoicePartyInfo;

  @Column({ type: 'jsonb' })
  buyerInfo: InvoicePartyInfo;

  @Column({ type: 'jsonb' })
  items: InvoiceItem[];

  /** ارز اصلی صورتحساب (IRR, USD, EUR, AED). */
  @Index()
  @Column({ type: 'varchar', length: 3, default: 'IRR' })
  currency: Currency;

  /** نرخ تبدیل ارز اصلی به ارز پایه (واحد ارز پایه به‌ازای ۱ واحد ارز فاکتور). */
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 1 })
  exchangeRate: number;

  /** ارز پایه مورد استفاده در تجمیع گزارش‌های بین‌المللی (USD). */
  @Column({ type: 'varchar', length: 3, default: 'USD' })
  baseCurrency: Currency;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  totalAmount: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  totalDiscount: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  totalTax: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  finalPayable: number;

  /** جمع ناخالص معادل ارز پایه. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  baseTotalAmount: number;

  /** جمع مالیات معادل ارز پایه. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  baseTotalTax: number;

  /** مبلغ نهایی قابل پرداخت معادل ارز پایه. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  baseFinalPayable: number;

  @Index()
  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus;

  @CreateDateColumn()
  createdAt: Date;
}
