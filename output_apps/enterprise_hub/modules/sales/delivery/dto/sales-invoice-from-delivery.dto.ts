import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsMoneyAmount } from '../../../accounting/dto/money.validator';
import { Money } from '../../../accounting/money';
import { FulfilmentStatus } from '../delivery-math';

/** Most lines one invoice from delivery may carry (same ceiling as deliveries and orders). */
export const MAX_INVOICE_DELIVERY_LINES = 200;

const MONEY = { oneOf: [{ type: 'number' }, { type: 'string' }], example: '100000.00' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One requested line: a delivery line id and how much of it is invoiced now. */
export class InvoiceFromDeliveryLineDto {
  @ApiProperty({ description: 'شناسه سطر حواله تحویل' })
  @IsInt()
  @Min(1)
  deliveryLineId: number;

  @ApiProperty({ description: 'مقدار صورتحساب‌شده (حداکثر دو رقم اعشار، مثبت)' })
  @IsMoneyAmount()
  quantity: number | string;
}

/** Body of `POST invoices/from-deliveries`. */
export class CreateInvoiceFromDeliveryDto {
  @ApiProperty({
    description: 'تاریخ صورتحساب (YYYY-MM-DD)؛ نرخ قانونی مالیات همان تاریخ از پارامترهای قانونی خوانده می‌شود.',
  })
  @Matches(DATE)
  invoiceDate: string;

  @ApiPropertyOptional({ description: 'کلید ایدمپوتنسی (تکرار همان کلید همان صورتحساب را برمی‌گرداند)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;

  @ApiProperty({ type: [InvoiceFromDeliveryLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INVOICE_DELIVERY_LINES)
  @ValidateNested({ each: true })
  @Type(() => InvoiceFromDeliveryLineDto)
  deliveryLines: InvoiceFromDeliveryLineDto[];
}

// ---------------------------------------------------------------------- responses

/** One invoice line tied back to the delivery line it bills. */
export class InvoiceDeliveryLinkResponseDto {
  @ApiProperty() deliveryId: number;
  @ApiProperty() deliveryNumber: string;
  @ApiProperty() deliveryLineId: number;
  @ApiProperty() orderLineId: number;
  @ApiProperty() itemId: number;
  @ApiProperty() sku: string;
  @ApiProperty({ description: 'شماره سطر صورتحساب (از ۱)' }) invoiceLineNo: number;
  @ApiProperty({ description: 'مقدار صورتحساب‌شده از این سطر حواله' }) quantity: number;
}

/** The invoice created (or replayed) from delivery lines. */
export class InvoiceFromDeliveryResponseDto {
  @ApiProperty() invoiceId: string;
  @ApiProperty() taxInvoiceNumber: string;
  @ApiProperty() status: string;
  @ApiProperty() partyCode: string;
  @ApiProperty({ description: 'تاریخ صورتحساب (YYYY-MM-DD)' }) invoiceDate: string;
  @ApiProperty({ ...MONEY, description: 'جمع قبل از مالیات' }) totalAmount: Money;
  @ApiProperty({ ...MONEY, description: 'جمع مالیات بر ارزش افزوده' }) totalTax: Money;
  @ApiProperty({ ...MONEY, description: 'مبلغ نهایی قابل پرداخت' }) finalPayable: Money;
  @ApiProperty({ description: 'در تکرار کلید یکتا true است' }) replayed: boolean;
  @ApiProperty({ type: [InvoiceDeliveryLinkResponseDto] }) lines: InvoiceDeliveryLinkResponseDto[];
}

/** Invoicing state of one order line: ordered, delivered, invoiced and what is left to invoice. */
export class OrderInvoicingLineResponseDto {
  @ApiProperty() orderLineId: number;
  @ApiProperty() itemId: number;
  @ApiProperty({ description: 'مقدار سفارش‌شده' }) ordered: number;
  @ApiProperty({ description: 'مقدار تحویل‌شده' }) delivered: number;
  @ApiProperty({ description: 'مقدار صورتحساب‌شده' }) invoiced: number;
  @ApiProperty({ description: 'باقی‌مانده قابل صورتحساب (تحویل‌شده منهای صورتحساب‌شده)' }) remaining: number;
  @ApiProperty({ enum: ['NONE', 'PARTIAL', 'COMPLETE'] }) status: FulfilmentStatus;
}

/** Response of `GET orders/:id/invoicing`. */
export class OrderInvoicingResponseDto {
  @ApiProperty() orderId: number;
  @ApiProperty({ enum: ['NONE', 'PARTIAL', 'COMPLETE'] }) status: FulfilmentStatus;
  @ApiProperty({ type: [OrderInvoicingLineResponseDto] }) lines: OrderInvoicingLineResponseDto[];
}
