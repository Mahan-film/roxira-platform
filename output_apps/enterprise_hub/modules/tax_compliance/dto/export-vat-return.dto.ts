import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { QuerySeasonalReportDto } from './query-seasonal-report.dto';

export class ExportVatReturnDto extends QuerySeasonalReportDto {
  @ApiPropertyOptional({ enum: ['xlsx', 'pdf'], default: 'xlsx' })
  @IsOptional()
  @IsIn(['xlsx', 'pdf'])
  format?: 'xlsx' | 'pdf';
}
