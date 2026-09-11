import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * اطلاعات هویتی موضوع گواهی (Certificate Subject) برای تولید CSR.
 * مقادیر به‌صورت RDN در ساختار PKCS#10 کدگذاری می‌شوند.
 */
export class CertificateSubjectDto {
  @ApiProperty({
    description: 'نام متعارف (Common Name) — نام سازمان مالیات‌دهنده',
    example: 'شرکت پیشرو تجارت',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  commonName: string;

  @ApiPropertyOptional({ description: 'نام سازمان', example: 'شرکت پیشرو تجارت' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  organization?: string;

  @ApiPropertyOptional({
    description: 'واحد سازمانی',
    example: 'مدیریت مالی و مالیاتی',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  organizationalUnit?: string;

  @ApiPropertyOptional({ description: 'کشور (کد دو حرفی)', example: 'IR' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @ApiPropertyOptional({ description: 'استان', example: 'تهران' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  state?: string;

  @ApiPropertyOptional({ description: 'شهر', example: 'تهران' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  locality?: string;

  @ApiPropertyOptional({ description: 'شناسه/کد ملی سازمان', example: '14001234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  serialNumber?: string;

  @ApiPropertyOptional({ description: 'رایانامه سازمان', example: 'tax@example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  emailAddress?: string;
}
