import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { JournalEntryStatus } from '../enums/accounting.enum';

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
}