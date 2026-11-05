import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Query of the sales report: grouping, an optional issue-date range (Tehran days, inclusive), JSON or a file. */
export class SalesReportQueryDto {
  @ApiProperty({ enum: ['item', 'customer'] })
  @IsIn(['item', 'customer'])
  groupBy: 'item' | 'customer';

  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ enum: ['xlsx', 'pdf'], description: 'Omit for JSON' })
  @IsOptional()
  @IsIn(['xlsx', 'pdf'])
  format?: 'xlsx' | 'pdf';
}
