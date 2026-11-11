import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class LoginTimeWindowDto {
  @ApiProperty({ description: 'Day of week: 0 (Sun) to 6 (Sat)', minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ description: 'Start time in minutes from midnight (0..1439)', minimum: 0, maximum: 1439 })
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute: number;

  @ApiProperty({ description: 'End time in minutes from midnight (0..1439)', minimum: 0, maximum: 1439 })
  @IsInt()
  @Min(0)
  @Max(1439)
  endMinute: number;
}

export class SetLoginScheduleDto {
  @ApiPropertyOptional({ description: 'IANA Timezone name e.g. Asia/Tehran', default: 'Asia/Tehran' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ description: 'Whether login schedule is enforced', default: true })
  @IsOptional()
  @IsBoolean()
  enforceSchedule?: boolean;

  @ApiProperty({ type: [LoginTimeWindowDto], description: 'Permitted weekly login time windows' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoginTimeWindowDto)
  windows: LoginTimeWindowDto[];
}
