import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MAX_INQUIRY_MESSAGE_LENGTH } from '../constants/inquiries.constants';

/**
 * DTO ثبت درخواست سازمانی (پیش‌ثبت‌نام / درخواست همکاری)
 * (POST /v1/enterprise/inquiries).
 */
export class CreateInquiryDto {
  @ApiProperty({ description: 'نام و نام خانوادگی متقاضی', example: 'سارا محمدی' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ description: 'نام شرکت / سازمان', example: 'شرکت فناوری روکسیرا' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  company?: string;

  @ApiProperty({ description: 'شماره تماس', example: '09121234567' })
  @IsString()
  @MinLength(7)
  @MaxLength(50)
  phone: string;

  @ApiProperty({ description: 'رایانامه سازمانی', example: 'sara@example.com' })
  @IsEmail()
  @MaxLength(150)
  email: string;

  @ApiPropertyOptional({
    description: 'توضیحات و نیازمندی‌های سازمان',
    maxLength: MAX_INQUIRY_MESSAGE_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_INQUIRY_MESSAGE_LENGTH)
  message?: string;

  @ApiPropertyOptional({
    description: 'منبع درخواست (مثلاً home-early-access)',
    example: 'home-early-access',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;
}
