import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AccountLevel } from '../enums/accounting.enum';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Period of a report: a fiscal year, a date range inside one, or just an end date. */
export class ReportPeriodDto {
  @ApiPropertyOptional({ description: 'Fiscal year id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fiscalYearId?: number;

  @ApiPropertyOptional({ example: '2026-03-21' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2027-03-20' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class TrialBalanceQueryDto extends ReportPeriodDto {
  @ApiPropertyOptional({ enum: [2, 4, 6, 8, 10], default: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([2, 4, 6, 8, 10])
  columns?: 2 | 4 | 6 | 8 | 10;

  @ApiPropertyOptional({ enum: AccountLevel, description: 'Roll up to this level; default is the posting accounts' })
  @IsOptional()
  @IsEnum(AccountLevel)
  level?: AccountLevel;

  @ApiPropertyOptional({ description: 'Show balances after the income summary and retained earnings transfers' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeClosing?: boolean;
}

export class SubsidiaryQueryDto extends TrialBalanceQueryDto {
  @ApiPropertyOptional({ description: 'Limit to one account and the accounts under it', example: '1020' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  accountCode?: string;
}

export class LedgerQueryDto extends ReportPeriodDto {
  @ApiPropertyOptional({ description: 'Account code; lines of the accounts under it are included', example: '10' })
  @IsString()
  @MaxLength(32)
  accountCode: string;

  @ApiPropertyOptional({ description: 'Only lines of this party (tafsili)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional({ default: 1000, maximum: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}

/** Receivable or payable ageing at one day. No endpoint yet (follow-up to #79). */
export class AgeingQueryDto {
  @ApiPropertyOptional({ enum: ['receivable', 'payable'], default: 'receivable' })
  @IsOptional()
  @IsIn(['receivable', 'payable'])
  side?: 'receivable' | 'payable';

  @ApiPropertyOptional({ description: 'Age at this day; default today', example: '2026-11-01' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({
    description: 'Limit to one account and the accounts under it; default all receivable (or payable) accounts',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  accountCode?: string;

  @ApiPropertyOptional({ description: 'Only this party (tafsili)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional({ description: 'Bucket edges in days, comma separated', example: '30,60,90' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((part) => Number(part.trim())) : value))
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(3650, { each: true })
  edges?: number[];
}

export const EXPORTABLE_REPORTS = [
  'trial-balance',
  'subsidiary',
  'ledger',
  'balance-sheet',
  'income-statement',
  'cash-flow',
  'equity-changes',
  'ageing',
  'chart-of-accounts',
] as const;
export type ExportableReport = (typeof EXPORTABLE_REPORTS)[number];

export class ExportReportQueryDto extends TrialBalanceQueryDto {
  @ApiPropertyOptional({ enum: ['xlsx', 'pdf'], default: 'xlsx' })
  @IsOptional()
  @IsIn(['xlsx', 'pdf'])
  format?: 'xlsx' | 'pdf';

  @ApiPropertyOptional({ description: 'Ledger and subsidiary reports' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  accountCode?: string;

  @ApiPropertyOptional({ description: 'Ledger and ageing reports' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional({ enum: ['receivable', 'payable'], default: 'receivable', description: 'Ageing report' })
  @IsOptional()
  @IsIn(['receivable', 'payable'])
  side?: 'receivable' | 'payable';

  @ApiPropertyOptional({ description: 'Ageing report: bucket edges in days, comma separated', example: '30,60,90' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((part) => Number(part.trim())) : value))
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(3650, { each: true })
  edges?: number[];
}
