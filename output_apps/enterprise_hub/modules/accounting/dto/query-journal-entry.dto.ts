import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { JournalEntryStatus } from '../enums/accounting.enum';
import { IsCalendarDate } from './calendar-date.validator';

/** Up to 16 integer digits (numeric(18,2)) and 2 decimals; no sign, no grouping. */
const AMOUNT = /^\d{1,16}(\.\d{1,2})?$/;

/**
 * DTO فیلتر/صفحه‌بندی دفتر روزنامه
 * (GET /enterprise-hub/accounting/journal-entries).
 */
export class QueryJournalEntryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'فیلتر بر اساس وضعیت سند', enum: JournalEntryStatus })
  @IsOptional()
  @IsEnum(JournalEntryStatus)
  status?: JournalEntryStatus;

  @ApiPropertyOptional({ description: 'جست‌وجوی جزئی در شماره سند' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entryNumber?: string;

  @ApiPropertyOptional({ description: 'از تاریخ سند (YYYY-MM-DD، شامل همان روز)', example: '2026-03-21' })
  @IsOptional()
  @IsCalendarDate('از تاریخ')
  fromDate?: string;

  @ApiPropertyOptional({ description: 'تا تاریخ سند (YYYY-MM-DD، شامل همان روز)', example: '2026-04-20' })
  @IsOptional()
  @IsCalendarDate('تا تاریخ')
  toDate?: string;

  @ApiPropertyOptional({ description: 'اسنادی که دست‌کم یک سطر روی این کد حساب دارند' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountCode?: string;

  @ApiPropertyOptional({ description: 'اسنادی که دست‌کم یک سطر برای این تفصیلی دارند' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional({ description: 'کمینهٔ مبلغ بدهکار یا بستانکار یک سطر', example: '5000000' })
  @IsOptional()
  @Matches(AMOUNT, { message: 'minAmount must be a non-negative decimal with at most 2 decimals' })
  minAmount?: string;

  @ApiPropertyOptional({ description: 'بیشینهٔ مبلغ بدهکار یا بستانکار یک سطر', example: '5000000' })
  @IsOptional()
  @Matches(AMOUNT, { message: 'maxAmount must be a non-negative decimal with at most 2 decimals' })
  maxAmount?: string;

  @ApiPropertyOptional({ description: 'جست‌وجو در شرح سند و شرح سطرها' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  text?: string;
}

/**
 * DTO فیلتر گردش حساب (GET /enterprise-hub/accounting/accounts/:code/ledger).
 */
export class QueryAccountLedgerDto {
  @ApiPropertyOptional({ description: 'تاریخ شروع بازه (ISO 8601)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  fromDate?: string;

  @ApiPropertyOptional({ description: 'تاریخ پایان بازه (ISO 8601)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  toDate?: string;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 100;

  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'شمارهٔ صفحهٔ ردیف‌ها؛ جمع‌ها و مانده‌ها همیشه برای کل بازه‌اند' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

/**
 * DTO فیلتر تراز آزمایشی (GET /enterprise-hub/accounting/trial-balance).
 *
 * با ارسال `currency` تنها سطرهای همان ارز در تراز لحاظ می‌شوند و جمع
 * مبالغ ارزی (amount_fx) و معادل ریالی آن‌ها نیز برگردانده می‌شود.
 */
export class QueryTrialBalanceDto {
  @ApiPropertyOptional({
    description: 'فیلتر ارز (کد ISO یا مترادف فارسی/فینگلیش)',
    example: 'USD',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  currency?: string;
}