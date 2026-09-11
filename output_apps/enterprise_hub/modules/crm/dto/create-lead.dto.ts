import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MIN_ESTIMATED_VALUE } from '../constants/crm.constants';
import { PipelineStage } from '../enums/crm.enums';

/**
 * DTO ثبت سرنخ جدید در پایپ‌لاین فروش
 * (POST /enterprise-hub/crm/leads).
 */
export class CreateLeadDto {
  @ApiProperty({ description: 'نام و نام خانوادگی سرنخ', example: 'سارا محمدی' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @ApiProperty({ description: 'رایانامه یکتا', example: 'sara.mohammadi@example.com' })
  @IsEmail()
  @MaxLength(120)
  email: string;

  @ApiPropertyOptional({ description: 'شماره تماس', example: '09121234567' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ description: 'نام شرکت / سازمان', example: 'شرکت فناوری روکسیرا' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  company?: string;

  @ApiPropertyOptional({
    description: 'مرحله اولیه پایپ‌لاین (پیش‌فرض: NEW)',
    enum: PipelineStage,
    default: PipelineStage.NEW,
  })
  @IsOptional()
  @IsEnum(PipelineStage)
  pipelineStage?: PipelineStage;

  @ApiPropertyOptional({
    description: 'ارزش ریالی برآوردی فرصت فروش',
    example: 250000000,
    minimum: MIN_ESTIMATED_VALUE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_ESTIMATED_VALUE)
  estimatedValue?: number;

  @ApiPropertyOptional({ description: 'کارشناس مسئول سرنخ', example: 'کارشناس فروش ۱' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  owner?: string;

  @ApiPropertyOptional({ description: 'یادداشت آغازین سرنخ' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
