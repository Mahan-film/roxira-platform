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
import { InquiryStatus } from '../enums/inquiry-status.enum';

/**
 * DTO فیلتر/صفحه‌بندی فهرست درخواست‌های سازمانی
 * (GET /v1/enterprise/inquiries — فقط ADMIN).
 */
export class QueryInquiryDto {
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

  @ApiPropertyOptional({ description: 'فیلتر بر اساس وضعیت', enum: InquiryStatus })
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;

  @ApiPropertyOptional({ description: 'جست‌وجو در نام، شرکت، رایانامه یا تلفن' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
