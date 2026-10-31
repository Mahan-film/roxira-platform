import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** Jalali year + quarter selecting a seasonal report period. */
export class QuerySeasonalReportDto {
  @ApiProperty({ description: 'سال شمسی', example: 1405 })
  @Type(() => Number)
  @IsInt({ message: 'سال باید عدد صحیح باشد.' })
  @Min(1300)
  @Max(1600)
  year: number;

  @ApiProperty({ description: 'فصل (۱ = فروردین تا خرداد … ۴ = دی تا اسفند)', example: 1 })
  @Type(() => Number)
  @IsInt({ message: 'فصل باید عدد صحیح باشد.' })
  @Min(1)
  @Max(4)
  quarter: number;
}
