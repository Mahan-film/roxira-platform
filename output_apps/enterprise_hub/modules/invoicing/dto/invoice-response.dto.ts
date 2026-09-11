import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../currency/enums/currency.enum';
import {
  InvoiceItem,
  InvoicePartyInfo,
} from '../entities/invoice.entity';
import { InvoiceStatus } from '../enums/invoice-status.enum';

/**
 * DTO خروجی صورتحساب مالیاتی (پاسخ تمام اندپوینت‌های ماژول).
 */
export class InvoiceResponseDto {
  @ApiProperty({ description: 'شناسه یکتای صورتحساب (UUID)' })
  id: string;

  @ApiProperty({ description: 'شماره یکتای صورتحساب مالیاتی' })
  taxInvoiceNumber: string;

  @ApiProperty({ description: 'اطلاعات فروشنده', type: Object })
  sellerInfo: InvoicePartyInfo;

  @ApiProperty({ description: 'اطلاعات خریدار', type: Object })
  buyerInfo: InvoicePartyInfo;

  @ApiProperty({ description: 'اقلام کالا/خدمت', type: [Object] })
  items: InvoiceItem[];

  @ApiProperty({ enum: Currency, description: 'ارز صورتحساب', example: Currency.IRR })
  currency: Currency;

  @ApiProperty({
    description: 'نرخ تبدیل ارز فاکتور به ارز پایه',
    example: 0.00000109,
  })
  exchangeRate: number;

  @ApiProperty({ enum: Currency, description: 'ارز پایه تجمیع', example: Currency.USD })
  baseCurrency: Currency;

  @ApiProperty({ description: 'جمع ناخالص مبالغ اقلام پیش از تخفیف و مالیات' })
  totalAmount: number;

  @ApiProperty({ description: 'جمع کل تخفیف‌ها' })
  totalDiscount: number;

  @ApiProperty({ description: 'جمع کل مالیات (۹٪ ارزش افزوده)' })
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

  @ApiProperty({ description: 'تاریخ ثبت صورتحساب در سیستم' })
  createdAt: Date;
}
