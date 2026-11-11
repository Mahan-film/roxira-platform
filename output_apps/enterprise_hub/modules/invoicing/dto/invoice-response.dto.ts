import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../currency/enums/currency.enum';
import {
  InvoiceItem,
  InvoicePartyInfo,
} from '../entities/invoice.entity';
import { InvoiceJurisdiction } from '../enums/invoice-jurisdiction.enum';
import {
  EInvoiceType,
  InvoiceDirection,
  InvoiceSubject,
} from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';

/**
 * DTO خروجی صورتحساب مالیاتی (پاسخ تمام اندپوینت‌های ماژول).
 */
export class InvoiceResponseDto {
  @ApiProperty({ description: 'شناسه یکتای صورتحساب (UUID)' })
  id: string;

  @ApiProperty({ description: 'شماره یکتای صورتحساب مالیاتی' })
  taxInvoiceNumber: string;

  @ApiProperty({ description: 'شناسه سرنخ/مشتری CRM', nullable: true })
  customerId: number | null;

  @ApiProperty({ description: 'اطلاعات فروشنده', type: Object })
  sellerInfo: InvoicePartyInfo;

  @ApiProperty({ description: 'اطلاعات خریدار', type: Object })
  buyerInfo: InvoicePartyInfo;

  @ApiProperty({ description: 'اقلام کالا/خدمت', type: [Object] })
  items: InvoiceItem[];

  @ApiProperty({ enum: Currency, description: 'ارز صورتحساب', example: Currency.IRR })
  currency: Currency;

  @ApiProperty({
    enum: InvoiceJurisdiction,
    description: 'حوزه قضایی/مالیاتی صورتحساب',
    example: InvoiceJurisdiction.IR,
  })
  jurisdiction: InvoiceJurisdiction;

  @ApiProperty({
    description: 'نرخ تبدیل ارز فاکتور به ارز پایه',
    example: 0.00000109,
  })
  exchangeRate: number;

  @ApiProperty({
    description: 'نرخ تبدیل ارز فاکتور به ریال (amount_fx × fx_rate = معادل ریالی)',
    example: 1,
  })
  fxRate: number;

  @ApiProperty({
    description: 'مبلغ صورتحساب به ارز مبدأ (amount_fx)',
    nullable: true,
  })
  amountFx: number | null;

  @ApiProperty({ enum: Currency, description: 'ارز پایه تجمیع', example: Currency.USD })
  baseCurrency: Currency;

  @ApiProperty({ description: 'جمع ناخالص مبالغ اقلام پیش از تخفیف و مالیات' })
  totalAmount: number;

  @ApiProperty({ description: 'جمع کل تخفیف‌ها' })
  totalDiscount: number;

  @ApiProperty({
    description:
      'Part of totalDiscount that is the invoice-level discount (already spread over the lines, VAT on the discounted base)',
  })
  invoiceDiscount: number;

  @ApiProperty({ description: 'جمع کل مالیات ارزش افزوده (نرخ هر سطر)' })
  totalTax: number;

  @ApiProperty({ description: 'مبلغ نهایی قابل پرداخت' })
  finalPayable: number;

  @ApiProperty({ description: 'جمع ناخالص معادل ارز پایه' })
  baseTotalAmount: number;

  @ApiProperty({ description: 'جمع مالیات معادل ارز پایه' })
  baseTotalTax: number;

  @ApiProperty({ description: 'مبلغ نهایی معادل ارز پایه' })
  baseFinalPayable: number;

  @ApiProperty({ enum: InvoiceStatus, description: 'وضعیت صورتحساب' })
  status: InvoiceStatus;

  @ApiProperty({ description: 'زمان صدور رسمی', nullable: true })
  issuedAt: Date | null;

  @ApiProperty({ description: 'زمان تسویه کامل', nullable: true })
  paidAt: Date | null;

  @ApiProperty({ description: 'شناسه سند حسابداری صدور', nullable: true })
  journalEntryId: number | null;

  @ApiProperty({ description: 'شناسه سند حسابداری تسویه', nullable: true })
  paidJournalEntryId: number | null;

  @ApiProperty({ description: 'شناسه سند حسابداری ابطال', nullable: true })
  reversalJournalEntryId: number | null;

  @ApiProperty({ description: 'آخرین خطای ثبت خودکار (در صورت وجود)', nullable: true })
  postingError: string | null;

  @ApiProperty({ description: 'تاریخ ثبت صورتحساب در سیستم' })
  createdAt: Date;

  @ApiProperty({ enum: InvoiceDirection, description: 'خرید یا فروش' })
  direction: InvoiceDirection;

  @ApiProperty({ enum: EInvoiceType, description: 'نوع صورتحساب الکترونیکی' })
  einvoiceType: EInvoiceType;

  @ApiProperty({ enum: InvoiceSubject, description: 'موضوع صورتحساب' })
  subject: InvoiceSubject;

  @ApiProperty({ description: 'صورتحساب مرجع', nullable: true })
  relatedInvoiceId: string | null;

  @ApiProperty({ description: 'انبار حرکت کالا', nullable: true })
  warehouseId: number | null;

  @ApiProperty({ description: 'وضعیت ارسال به سامانه مودیان', nullable: true })
  moadianStatus?: string | null;

  @ApiProperty({ description: 'متن خطای سامانه مودیان (در صورت عدم موفقیت)', nullable: true })
  moadianErrorText?: string | null;

  @ApiProperty({ description: 'کد مالیاتی ۲۲ رقمی سامانه مودیان', nullable: true })
  moadianTaxId?: string | null;
}
