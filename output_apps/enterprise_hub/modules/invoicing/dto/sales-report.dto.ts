import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Query of the sales report: grouping, an optional issue-date range (Tehran days, inclusive), JSON or a file. */
export class SalesReportQueryDto {
  @ApiProperty({ enum: ['item', 'customer', 'salesperson'] })
  @IsIn(['item', 'customer', 'salesperson'])
  groupBy: 'item' | 'customer' | 'salesperson';

  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ description: 'فیلتر بر اساس شناسه شعبه' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: ['xlsx', 'pdf'], description: 'Omit for JSON' })
  @IsOptional()
  @IsIn(['xlsx', 'pdf'])
  format?: 'xlsx' | 'pdf';
}
