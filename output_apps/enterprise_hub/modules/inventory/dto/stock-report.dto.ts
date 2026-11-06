import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Query of one SKU's cardex: optional warehouse and a day range (Tehran days, inclusive), JSON or a file. */
export class CardexQueryDto {
  @ApiProperty({ description: 'شناسه کالا (SKU)', example: 'SKU-1001' })
  @IsString()
  @MaxLength(64)
  sku: string;

  @ApiPropertyOptional({ description: 'محدود کردن به یک انبار؛ خالی یعنی همه انبارها' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId?: number;

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

/** Query of the stock balance: an as-of day, a view (balance or reorder alerts), JSON or a file. */
export class StockBalanceQueryDto {
  @ApiPropertyOptional({ example: '2026-05-31', description: 'تا این تاریخ؛ پیش‌فرض امروز به وقت تهران' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'asOf must be YYYY-MM-DD' })
  asOf?: string;

  @ApiPropertyOptional({ enum: ['balance', 'reorder'], description: 'پیش‌فرض balance' })
  @IsOptional()
  @IsIn(['balance', 'reorder'])
  view?: 'balance' | 'reorder';

  @ApiPropertyOptional({ enum: ['xlsx', 'pdf'], description: 'Omit for JSON' })
  @IsOptional()
  @IsIn(['xlsx', 'pdf'])
  format?: 'xlsx' | 'pdf';
}
