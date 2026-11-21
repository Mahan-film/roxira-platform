import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { Money } from '../../../accounting/money';
import { InvoiceStatus } from '../../../invoicing/enums/invoice-status.enum';
import { InvoiceResponseDto } from '../../../invoicing/dto/invoice-response.dto';

export class ConvertQuotationToInvoiceDto {
  @ApiPropertyOptional({
    description: 'تاریخ صدور صورتحساب (YYYY-MM-DD)؛ در نبود مقدار، تاریخ روز در نظر گرفته می‌شود.',
    example: '2026-11-13',
  })
  @IsOptional()
  @IsISO8601()
  invoiceDate?: string;

  @ApiPropertyOptional({
    description: 'وضعیت صورتحساب اولیه (DRAFT یا ISSUED). پیش‌فرض: ISSUED',
    enum: InvoiceStatus,
    default: InvoiceStatus.ISSUED,
  })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({
    description: 'شماره یکتای اداری صورتحساب؛ در نبود مقدار، سرور به صورت خودکار شماره صادر می‌کند.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxInvoiceNumber?: string;

  @ApiPropertyOptional({
    description: 'کلید تکرارناپذیری (Idempotency Key) اختیاری سمت کلاینت',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: 'شناسه انبار اختیاری جهت خروج انبار',
  })
  @IsOptional()
  @IsInt()
  warehouseId?: number;
}

export class ConvertQuotationToInvoiceResponseDto {
  @ApiProperty({ description: 'شناسه پیش‌فاکتور' })
  quotationId: number;

  @ApiProperty({ description: 'شماره پیش‌فاکتور' })
  quotationNumber: string;

  @ApiProperty({ description: 'شناسه یکتای صورتحساب صادرشده' })
  invoiceId: string;

  @ApiProperty({ description: 'شماره مالیاتی / اداری صورتحساب' })
  taxInvoiceNumber: string;

  @ApiProperty({ description: 'وضعیت صورتحساب' })
  status: string;

  @ApiProperty({ description: 'کد طرف‌حساب' })
  partyCode: string;

  @ApiProperty({ description: 'تاریخ صدور صورتحساب' })
  invoiceDate: string;

  @ApiProperty({ description: 'مبلغ کل قبل از تخفیف و مالیات' })
  totalAmount: Money;

  @ApiProperty({ description: 'مبلغ مالیات ارزش افزوده' })
  totalTax: Money;

  @ApiProperty({ description: 'مبلغ نهایی قابل پرداخت' })
  finalPayable: Money;

  @ApiProperty({ description: 'نشانگر این‌که درخواست پاسخِ بازپخش‌شده است' })
  replayed: boolean;

  @ApiProperty({ type: InvoiceResponseDto, description: 'جزئیات کامل صورتحساب ایجادشده' })
  invoice: InvoiceResponseDto;
}
