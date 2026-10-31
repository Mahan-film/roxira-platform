import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { MAX_MULTI_FILES } from '../constants/package-import.constants';

export class InitUploadDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ description: 'حجم کل فایل به بایت' })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  size: number;

  @ApiPropertyOptional({ description: 'اندازهٔ تکه (۲۵۶KB تا ۸MB)' })
  @IsOptional()
  @IsInt()
  chunkSize?: number;

  @ApiPropertyOptional({ description: 'SHA-256 فایل کامل (هگز) برای راستی‌آزمایی' })
  @IsOptional()
  @IsString()
  sha256?: string;
}

export class UploadStatusDto {
  @ApiProperty() uploadId: string;
  @ApiProperty() size: number;
  @ApiProperty() chunkSize: number;
  @ApiProperty() totalChunks: number;
  @ApiProperty({ type: [Number] }) received: number[];
  @ApiProperty({ type: [Number] }) missing: number[];
  @ApiProperty() complete: boolean;
}

export class PackageFromUploadsDto {
  @ApiProperty({ type: [String], description: 'شناسهٔ بارگذاری‌های کامل‌شده (یک فایل یا چند فایل/پوشه)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MULTI_FILES)
  @IsUUID('4', { each: true })
  uploadIds: string[];
}
