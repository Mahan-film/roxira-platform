import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Gender, MaritalStatus } from '../enums/hr.enum';

/**
 * DTO ثبت پرسنل جدید (POST /enterprise-hub/hr/employees).
 *
 * در صورت عدم ارسال `employeeNumber`، سرویس کد پرسنلی یکتا تولید می‌کند.
 */
export class CreateEmployeeDto {
  @ApiPropertyOptional({
    description: 'کد پرسنلی یکتا؛ در صورت عدم ارسال خودکار تولید می‌شود',
    example: 'EMP-000001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  employeeNumber?: string;

  @ApiProperty({ description: 'نام', example: 'سارا' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  firstName: string;

  @ApiProperty({ description: 'نام خانوادگی', example: 'محمدی' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  lastName: string;

  @ApiProperty({ description: 'کد ملی ۱۰ رقمی', example: '0079541234' })
  @IsString()
  @Matches(/^[0-9]{10}$/, { message: 'کد ملی باید دقیقاً ۱۰ رقم باشد.' })
  nationalId: string;

  @ApiPropertyOptional({ description: 'نام پدر', example: 'حسن' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fatherName?: string;

  @ApiPropertyOptional({
    description: 'تاریخ تولد (ISO 8601)',
    example: '1990-05-20',
  })
  @IsOptional()
  @IsISO8601()
  birthDate?: string;

  @ApiPropertyOptional({ enum: Gender, default: Gender.MALE })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiProperty({ description: 'شماره همراه', example: '09121234567' })
  @IsString()
  @Matches(/^0?9[0-9]{9}$/, {
    message: 'شماره همراه باید با 09 شروع شده و ۱۱ رقم باشد.',
  })
  mobile: string;

  @ApiPropertyOptional({ description: 'رایانامه', example: 'sara@roxira.ir' })
  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @ApiProperty({ description: 'عنوان شغلی', example: 'کارشناس منابع انسانی' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  jobTitle: string;

  @ApiProperty({ description: 'واحد سازمانی', example: 'منابع انسانی' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  department: string;

  @ApiPropertyOptional({ enum: MaritalStatus, default: MaritalStatus.SINGLE })
  @IsOptional()
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @ApiPropertyOptional({ description: 'تعداد فرزندان مشمول حق اولاد', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  dependants?: number;

  @ApiPropertyOptional({
    description: 'تاریخ استخدام (ISO 8601)؛ پیش‌فرض امروز',
    example: '2026-09-11',
  })
  @IsOptional()
  @IsISO8601()
  hireDate?: string;

  @ApiPropertyOptional({
    description: 'شماره حساب بانکی جهت واریز حقوق',
    example: 'IR820540102680020817909002',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankAccountNumber?: string;
}
