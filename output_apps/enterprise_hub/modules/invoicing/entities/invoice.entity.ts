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
  /** شناسه کالای انبار (اختیاری) — پیوند سطر به `erp_stock_items`. */
  itemId?: number | null;
  /** شناسه یکتای کالا (SKU) در زمان صدور صورتحساب. */
  sku?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  /** نرخ مالیات بر ارزش افزوده سطر (نسبت؛ ۰٫۱ = ۱۰٪). */
  vatRate: number;
  tax: number;
  total: number;
}

/**
 * موجودیت پایگاه‌داده صورتحساب مالیاتی هوشمند (Smart Invoicing).
 * فقط از طریق InvoicingRepository قابل دسترسی است (Rule #3 - AGENTS.md).
 */
@Entity({ name: 'invoices' })
@Index('IDX_invoices_tenant_taxInvoiceNumber', ['tenantId', 'taxInvoiceNumber'], {
  unique: true,
})
@Index('IDX_invoices_tenant_createdAt', ['tenantId', 'createdAt'])
@Index('IDX_invoices_tenant_status', ['tenantId', 'status'])
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** شناسه سازمان مالک صورتحساب (تنها از توکن تأییدشده JWT). */
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  taxInvoiceNumber: string;

  /** پیوند اختیاری به سرنخ/مشتری CRM (`crm_leads.id`) در همان مستأجر. */
  @Index()
  @Column({ type: 'int', name: 'customer_id', nullable: true })
  customerId: number | null;

  @Column({ type: 'jsonb' })
  sellerInfo: InvoicePartyInfo;

  @Column({ type: 'jsonb' })
  buyerInfo: InvoicePartyInfo;

  @Column({ type: 'jsonb' })
  items: InvoiceItem[];

  /** ارز اصلی صورتحساب (IRR, IRT, USD, EUR, AED, …). */
  @Index()
  @Column({ type: 'varchar', length: 8, default: 'IRR' })
  currency: Currency;

  /** نرخ تبدیل ارز اصلی به ارز پایه (واحد ارز پایه به‌ازای ۱ واحد ارز فاکتور). */
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 1 })
  exchangeRate: number;

  /** نرخ تبدیل ارز فاکتور به ریال (هسته حسابداری چندارزی). */
  @Column({ type: 'decimal', precision: 24, scale: 6, name: 'fx_rate', default: 1 })
  fxRate: number;

  /** مبلغ فاکتور به ارز مبدأ (اختیاری) — ردیابی اسناد چندارزی. */
  @Column({
    type: 'decimal',
    precision: 24,
    scale: 6,
    name: 'amount_fx',
    nullable: true,
  })
  amountFx: number | null;

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

  /** زمان صدور رسمی صورتحساب (اولین گذر از DRAFT به ISSUED/PAID). */
  @Column({ type: 'timestamp', name: 'issued_at', nullable: true })
  issuedAt: Date | null;

  /** زمان تسویه کامل صورتحساب. */
  @Column({ type: 'timestamp', name: 'paid_at', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
