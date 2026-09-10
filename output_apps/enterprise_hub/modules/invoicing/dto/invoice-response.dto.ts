import { ApiProperty } from '@nestjs/swagger';
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

  @ApiProperty({ description: 'جمع ناخالص مبالغ اقلام پیش از تخفیف و مالیات' })
  totalAmount: number;

  @ApiProperty({ description: 'جمع کل تخفیف‌ها' })
  totalDiscount: number;

  @ApiProperty({ description: 'جمع کل مالیات (۹٪ ارزش افزوده)' })
  totalTax: number;

  @ApiProperty({ description: 'مبلغ نهایی قابل پرداخت' })
  finalPayable: number;

  @ApiProperty({ enum: InvoiceStatus, description: 'وضعیت صورتحساب' })
  status: InvoiceStatus;

  @ApiProperty({ description: 'تاریخ ثبت صورتحساب در سیستم' })
  createdAt: Date;
}
