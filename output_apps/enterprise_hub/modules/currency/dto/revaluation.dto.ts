import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Currency } from '../enums/currency.enum';

export class ForeignAccountBalanceDto {
  @ApiProperty({ description: 'کد حساب کل یا معین در سرفصل حساب‌ها', example: '1012' })
  @IsString()
  @IsNotEmpty()
  accountCode: string;

  @ApiProperty({ description: 'عنوان حساب', example: 'بانک ارزی دلاری' })
  @IsString()
  @IsNotEmpty()
  accountName: string;

  @ApiProperty({ enum: Currency, description: 'کد ارز', example: Currency.USD })
  @IsEnum(Currency)
  currency: Currency;

  @ApiProperty({ description: 'مبلغ ارزی بر حسب واحدهای جزء (سنت)', example: '100000' })
  @IsNotEmpty()
  foreignAmountMinor: string;

  @ApiProperty({ description: 'ارزش دفتری ریالی فعلی در دفتر کل', example: '5000000000' })
  @IsNotEmpty()
  bookValueRialMinor: string;

  @ApiPropertyOptional({ description: 'آیا حساب بدهی است (مثل حساب پرداختنی ارزی)', default: false })
  @IsOptional()
  @IsBoolean()
  isLiability?: boolean;
}

export class RevalueBalancesDto {
  @ApiProperty({ description: 'شناسه سازمان (Tenant UUID)' })
  @IsUUID()
  tenantId: string;

  @ApiProperty({ description: 'دوره مالی یا ماه تسعیر', example: '1405-08' })
  @IsString()
  @IsNotEmpty()
  period: string;

  @ApiProperty({ description: 'تاریخ صدور سند به فرمت YYYY-MM-DD', example: '2026-11-21' })
  @IsString()
  @IsNotEmpty()
  date: string;

  @ApiProperty({ type: [ForeignAccountBalanceDto], description: 'فهرست مانده حساب‌های ارزی' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ForeignAccountBalanceDto)
  balances: ForeignAccountBalanceDto[];
}
