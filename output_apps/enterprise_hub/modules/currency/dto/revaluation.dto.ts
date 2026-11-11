import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Currency } from '../enums/currency.enum';

export class ForeignAccountBalanceDto {
  @ApiProperty({ description: 'کد حساب کل یا معین در سرفصل حساب‌ها', example: '1012' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9A-Za-z_-]{2,20}$/, { message: 'accountCode must be 2-20 alphanumeric characters' })
  accountCode: string;

  @ApiProperty({ description: 'عنوان حساب', example: 'بانک ارزی دلاری' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  accountName: string;

  @ApiProperty({ enum: Currency, description: 'کد ارز', example: Currency.USD })
  @IsEnum(Currency)
  currency: Currency;

  @ApiProperty({ description: 'مبلغ ارزی بر حسب واحدهای جزء (سنت)', example: '100000' })
  @IsNotEmpty()
  @IsNumberString({ no_symbols: true }, { message: 'foreignAmountMinor must be a non-negative integer string' })
  @MaxLength(32, { message: 'foreignAmountMinor must not exceed 32 digits' })
  foreignAmountMinor: string;

  @ApiProperty({ description: 'ارزش دفتری ریالی فعلی در دفتر کل', example: '5000000000' })
  @IsNotEmpty()
  @IsNumberString({ no_symbols: true }, { message: 'bookValueRialMinor must be a non-negative integer string' })
  @MaxLength(32, { message: 'bookValueRialMinor must not exceed 32 digits' })
  bookValueRialMinor: string;

  @ApiPropertyOptional({
    description: 'نرخ تسعیر ریالی برای هر واحد ارز در تاریخ پایان دوره (اختیاری؛ در صورت عدم ارسال از جدول نرخ سیستم استفاده می‌شود)',
    example: '920000',
  })
  @IsOptional()
  @IsNumberString({ no_symbols: true }, { message: 'rateRialPerUnit must be a non-negative integer string' })
  @MaxLength(32, { message: 'rateRialPerUnit must not exceed 32 digits' })
  rateRialPerUnit?: string;

  @ApiPropertyOptional({ description: 'آیا حساب بدهی است (مثل حساب پرداختنی ارزی)', default: false })
  @IsOptional()
  @IsBoolean()
  isLiability?: boolean;
}

export class RevalueBalancesDto {
  @ApiProperty({ description: 'دوره مالی یا ماه تسعیر به فرمت YYYY-MM', example: '1405-08' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must match YYYY-MM format with valid month (01-12)' })
  period: string;

  @ApiProperty({ description: 'تاریخ صدور سند به فرمت YYYY-MM-DD', example: '2026-11-21' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { message: 'date must match valid YYYY-MM-DD format' })
  date: string;

  @ApiPropertyOptional({
    description: 'جدول نرخ‌های تسعیر پایانی به تفکیک کد ارز (اختیاری)',
    example: { USD: '920000', EUR: '1000000' },
  })
  @IsOptional()
  rates?: Record<string, string>;

  @ApiProperty({ type: [ForeignAccountBalanceDto], description: 'فهرست مانده حساب‌های ارزی' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ForeignAccountBalanceDto)
  balances: ForeignAccountBalanceDto[];
}
