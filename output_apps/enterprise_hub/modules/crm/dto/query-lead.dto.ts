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
import { PipelineStage } from '../enums/crm.enums';

/**
 * DTO فیلتر/صفحه‌بندی فهرست سرنخ‌ها
 * (GET /enterprise-hub/crm/leads).
 */
export class QueryLeadDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'فیلتر بر اساس مرحله پایپ‌لاین', enum: PipelineStage })
  @IsOptional()
  @IsEnum(PipelineStage)
  stage?: PipelineStage;

  @ApiPropertyOptional({ description: 'جست‌وجوی جزئی در نام، رایانامه، شرکت یا تلفن' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

/**
 * DTO فیلتر/صفحه‌بندی سوابق تماس یک سرنخ
 * (GET /enterprise-hub/crm/leads/:id/contacts).
 */
export class QueryContactRecordDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 20;
}
