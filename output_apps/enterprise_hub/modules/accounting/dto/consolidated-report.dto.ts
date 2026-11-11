import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class ConsolidatedReportQueryDto {
  @ApiPropertyOptional({
    description: 'شناسه‌های سازمان‌ها (حداکثر ۲۰ مورد به صورت آرایه یا کاما-جداشده)',
    example: '11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    return Array.isArray(value) ? value : value;
  })
  @IsArray()
  @IsUUID('4', { each: true, message: 'هر شناسه سازمان باید یک UUIDv4 معتبر باشد.' })
  @ArrayMaxSize(20, { message: 'حداکثر ۲۰ سازمان می‌تواند همزمان انتخاب شود.' })
  tenantIds?: string[];

  @ApiPropertyOptional({ enum: ['trial-balance'], default: 'trial-balance' })
  @IsOptional()
  @IsIn(['trial-balance'])
  reportType?: 'trial-balance';

  @ApiPropertyOptional({ enum: [2, 4, 6, 8, 10], default: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([2, 4, 6, 8, 10])
  columns?: 2 | 4 | 6 | 8 | 10;

  @ApiPropertyOptional({ example: '2026-03-21' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2027-03-20' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ description: 'مبنای گزارش تا تاریخ (معادل to)', example: '2027-03-20' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'asOfDate must be YYYY-MM-DD' })
  asOfDate?: string;
}
