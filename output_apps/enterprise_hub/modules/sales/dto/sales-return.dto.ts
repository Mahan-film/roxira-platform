import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Money } from '../../../accounting/money';

/** خط برگشتی. */
export class ReturnLineResponseDto {
  @ApiProperty({ description: 'شناسه خط حواله تحویل' })
  deliveryLineId: number;

  @ApiProperty({ description: 'مقدار برگشتی' })
  quantity: number;

  @ApiProperty({ description: 'واحد قیمت شده در زمان برگشت' })
  unitCost: Money;

  @ApiProperty({ description: 'مبلغ برگشتی' })
  value: Money;
}

/** خط درخواست برگشت. */
export class ReturnLineRequestDto {
  @ApiProperty({ description: 'شناسه خط حواله تحویل' })
  @IsInt()
  @Min(1)
  deliveryLineId: number;

  @ApiProperty({ description: 'مقدار برگشتی (حداکثر دو رقم اعشار)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  quantity: number;
}

/** بدنه درخواست ایجاد برگشت. */
export class CreateReturnDto {
  @ApiProperty({ description: 'خطوط برگشتی' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineRequestDto)
  lines: ReturnLineRequestDto[];

  @ApiProperty({ description: 'تاریخ برگشت (YYYY-MM-DD)' })
  @IsString()
  @MaxLength(10)
  returnDate: string;

  @ApiPropertyOptional({ description: 'کلید ایدمپوتنسی (تکرار همان کلید همان برگشت را برمی‌گرداند)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}

/** پاسخ دریافت برگشت. */
export class ReturnResponseDto {
  @ApiProperty({ description: 'شناسه صورتحساب برگشتی' })
  id: string;

  @ApiProperty({ description: 'شماره صورتحساب برگشتی' })
  taxInvoiceNumber: string;

  @ApiProperty({ description: 'شناسه صورتحباب مرجع (فروش)' })
  relatedInvoiceId: string;

  @ApiProperty({ description: 'ایتم‌های صورتحساب برگشتی' })
  items: ReturnLineResponseDto[];

  @ApiProperty({ description: 'مبلغ قابل پرداخت' })
  finalPayable: Money;

  @ApiProperty({ description: 'وضعیت صورتحساب' })
  status: string;
}