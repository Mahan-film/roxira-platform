import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { API_SCOPES, MAX_RATE_LIMIT_PER_MINUTE } from '../constants/public-api.constants';

export class CreateApiTokenDto {
  @ApiProperty({ description: 'نام توکن (برای تشخیص در فهرست)', example: 'اتصال فروشگاه' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({ description: 'دسترسی‌های توکن', enum: API_SCOPES, isArray: true, example: ['invoices:write', 'items:read'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(API_SCOPES.length)
  @ArrayUnique()
  @IsIn(API_SCOPES, { each: true })
  scopes: string[];

  @ApiPropertyOptional({ description: 'سقف درخواست در دقیقه برای این توکن', example: 60 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RATE_LIMIT_PER_MINUTE)
  rateLimitPerMinute?: number;

  @ApiPropertyOptional({ description: 'تاریخ انقضا (ISO 8601). بدون مقدار: بدون انقضا.', example: '2027-01-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class ApiTokenResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'ابتدای توکن برای تشخیص', example: 'rxk_1a2b3c4d' }) tokenPrefix: string;
  @ApiProperty({ isArray: true, type: String }) scopes: string[];
  @ApiProperty() rateLimitPerMinute: number;
  @ApiProperty({ nullable: true, type: String }) expiresAt: string | null;
  @ApiProperty({ nullable: true, type: String }) revokedAt: string | null;
  @ApiProperty({ nullable: true, type: String }) lastUsedAt: string | null;
  @ApiProperty() createdAt: string;
}

export class CreatedApiTokenResponseDto extends ApiTokenResponseDto {
  @ApiProperty({ description: 'توکن کامل. فقط همین یک بار نمایش داده می‌شود و قابل بازیابی نیست.' })
  token: string;
}
