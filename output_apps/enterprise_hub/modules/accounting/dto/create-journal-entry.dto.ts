import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_JOURNAL_LINES,
  MIN_JOURNAL_LINES,
} from '../constants/accounting.constants';

/**
 * DTO یک سطر سند دوطرفه (بدهکار یا بستانکار).
 *
 * اعتبارسنجی نهایی «دقیقاً یکی از بدهکار/بستانکار بزرگ‌تر از صفر» و نیز
 * «برابری جمع بدهکار و بستانکار» در لایه Service انجام می‌شود.
 */
export class JournalEntryLineDto {
  @ApiProperty({ description: 'کد حساب دفتر کل', example: '1010' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  accountCode: string;

  @ApiPropertyOptional({ description: 'مبلغ بدهکار (ریال)', example: 1000000, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit?: number;

  @ApiPropertyOptional({ description: 'مبلغ بستانکار (ریال)', example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit?: number;

  @ApiPropertyOptional({ description: 'شرح سطر', example: 'دریافت نقدی بابت فروش' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

/**
 * DTO ثبت سند حسابداری دوطرفه
 * (POST /enterprise-hub/accounting/journal-entries).
 */
export class CreateJournalEntryDto {
  @ApiProperty({ description: 'شماره یکتای سند حسابداری', example: 'JV-1405-000001' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  entryNumber: string;

  @ApiPropertyOptional({
    description: 'تاریخ سند (ISO 8601)؛ در صورت عدم ارسال، زمان جاری سرور',
    example: '2026-09-11T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  date?: string;

  @ApiProperty({ description: 'شرح کلی سند', example: 'فروش نقدی خدمات مشاوره' })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  description: string;

  @ApiProperty({
    type: [JournalEntryLineDto],
    description: 'سطرهای بدهکار/بستانکار سند (حداقل دو سطر)',
  })
  @IsArray()
  @ArrayMinSize(MIN_JOURNAL_LINES)
  @ArrayMaxSize(MAX_JOURNAL_LINES)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  lines: JournalEntryLineDto[];
}