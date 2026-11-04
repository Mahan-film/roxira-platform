import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { QuerySeasonalReportDto } from './query-seasonal-report.dto';

/** Jalali season selecting the journal/ledger export, optionally limited to one account code. */
export class QueryLedgerExportDto extends QuerySeasonalReportDto {
  @ApiPropertyOptional({ description: 'Ledger only: one account code', example: '2020' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[0-9A-Za-z._-]+$/, { message: 'کد حساب نامعتبر است.' })
  accountCode?: string;
}
