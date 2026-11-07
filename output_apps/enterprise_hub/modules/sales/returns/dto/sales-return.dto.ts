import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One returned line: a delivery line of the invoice and the quantity sent back (decimal, 2 places). */
export class ReturnLineRequestDto {
  @ApiProperty({ description: 'شناسه خط حواله تحویل' })
  @IsInt()
  @Min(1)
  deliveryLineId: number;

  @ApiProperty({ description: 'مقدار برگشتی (مثبت، حداکثر دو رقم اعشار)', type: 'string', example: '2.00' })
  @IsNotEmpty()
  quantity: number | string;
}

/** Body of a partial return from a delivery invoice. */
export class CreateReturnDto {
  @ApiProperty({ description: 'خطوط برگشتی' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineRequestDto)
  lines: ReturnLineRequestDto[];

  @ApiProperty({ description: 'تاریخ برگشت (YYYY-MM-DD)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  returnDate: string;

  @ApiPropertyOptional({ description: 'کلید ایدمپوتنسی (تکرار همان کلید همان برگشت را برمی‌گرداند)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}

/** A returned line as stored on the RETURN invoice. */
export class ReturnLineResponseDto {
  @ApiProperty({ description: 'شناسه خط حواله تحویل' })
  deliveryLineId: number;

  @ApiProperty({ description: 'مقدار برگشتی' })
  quantity: number;
}

/** Response of a return: the RETURN invoice and the delivery lines it sends back. */
export class ReturnResponseDto {
  @ApiProperty({ description: 'شناسه صورتحساب برگشتی' })
  id: string;

  @ApiProperty({ description: 'شماره صورتحساب برگشتی' })
  taxInvoiceNumber: string;

  @ApiProperty({ description: 'شناسه صورتحساب مرجع (فروش)' })
  relatedInvoiceId: string;

  @ApiProperty({ type: [ReturnLineResponseDto] })
  items: ReturnLineResponseDto[];

  @ApiProperty({ description: 'مبلغ قابل پرداخت (برگشتی)' })
  finalPayable: number;

  @ApiProperty({ description: 'وضعیت صورتحساب' })
  status: string;
}
