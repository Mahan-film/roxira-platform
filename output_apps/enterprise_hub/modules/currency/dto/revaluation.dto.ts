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
  foreignAmountMinor: string;

  @ApiProperty({ description: 'ارزش دفتری ریالی فعلی در دفتر کل', example: '5000000000' })
  @IsNotEmpty()
  @IsNumberString({ no_symbols: true }, { message: 'bookValueRialMinor must be a non-negative integer string' })
  bookValueRialMinor: string;

  @ApiPropertyOptional({ description: 'آیا حساب بدهی است (مثل حساب پرداختنی ارزی)', default: false })
  @IsOptional()
  @IsBoolean()
  isLiability?: boolean;
}

export class RevalueBalancesDto {
  @ApiProperty({ description: 'دوره مالی یا ماه تسعیر', example: '1405-08' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}$/, { message: 'period must match YYYY-MM format (e.g. 1405-08)' })
  period: string;

  @ApiProperty({ description: 'تاریخ صدور سند به فرمت YYYY-MM-DD', example: '2026-11-21' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must match YYYY-MM-DD format' })
  date: string;

  @ApiProperty({ type: [ForeignAccountBalanceDto], description: 'فهرست مانده حساب‌های ارزی' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ForeignAccountBalanceDto)
  balances: ForeignAccountBalanceDto[];
}
