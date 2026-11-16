import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FxRateType } from '../enums/accounting.enum';
import { IsMoneyAmount } from './money.validator';

export class CreateFxRateDto {
  @ApiProperty({ description: 'ارز پایه (مبدأ)', example: 'USD' })
  @IsString()
  @MinLength(1)
  @MaxLength(8)
  baseCurrency: string;

  @ApiProperty({ description: 'ارز مظنه (مقصد / ارز دفاتر)', example: 'IRR' })
  @IsString()
  @MinLength(1)
  @MaxLength(8)
  quoteCurrency: string;

  @ApiProperty({ description: 'تاریخ اعمال نرخ (YYYY-MM-DD)', example: '2026-11-16' })
  @IsISO8601()
  rateDate: string;

  @ApiProperty({
    enum: FxRateType,
    description: 'نوع نرخ: SPOT (لحظه‌ای)، TAX_OFFICIAL (رسمی مالیاتی)، CLOSING (پایانی)',
    example: FxRateType.SPOT,
  })
  @IsEnum(FxRateType)
  rateType: FxRateType;

  @ApiProperty({ description: 'نرخ تسعیر', example: 920000 })
  @IsMoneyAmount(6)
  rate: number | string;

  @ApiPropertyOptional({ description: 'منبع اعلام نرخ', example: 'CBI' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;
}

export class QueryFxRatesDto {
  @ApiPropertyOptional({ description: 'فیلتر بر اساس ارز پایه' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  baseCurrency?: string;

  @ApiPropertyOptional({ description: 'فیلتر بر اساس ارز مظنه' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  quoteCurrency?: string;

  @ApiPropertyOptional({ description: 'فیلتر بر اساس تاریخ' })
  @IsOptional()
  @IsISO8601()
  rateDate?: string;

  @ApiPropertyOptional({ enum: FxRateType, description: 'فیلتر بر اساس نوع نرخ' })
  @IsOptional()
  @IsEnum(FxRateType)
  rateType?: FxRateType;
}

export class FxRateResponseDto {
  @ApiProperty({ description: 'شناسه یکتای نرخ' })
  id: string;

  @ApiProperty({ description: 'ارز پایه' })
  baseCurrency: string;

  @ApiProperty({ description: 'ارز مظنه' })
  quoteCurrency: string;

  @ApiProperty({ description: 'تاریخ اعمال نرخ' })
  rateDate: string;

  @ApiProperty({ enum: FxRateType, description: 'نوع نرخ' })
  rateType: FxRateType;

  @ApiProperty({ description: 'نرخ تسعیر عددی' })
  rate: number;

  @ApiProperty({ description: 'منبع اعلام نرخ', nullable: true })
  source: string | null;

  @ApiProperty({ description: 'زمان ثبت' })
  createdAt: Date;
}
