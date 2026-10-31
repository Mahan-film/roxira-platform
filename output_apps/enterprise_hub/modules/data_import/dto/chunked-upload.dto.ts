import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_CHUNK_BYTES, MAX_MULTI_FILES, MIN_CHUNK_BYTES } from '../constants/package-import.constants';

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
  @Min(MIN_CHUNK_BYTES)
  @Max(MAX_CHUNK_BYTES)
  chunkSize?: number;

  @ApiPropertyOptional({ description: 'SHA-256 فایل کامل (هگز) برای راستی‌آزمایی' })
  @IsOptional()
  @Matches(/^[0-9a-f]{64}$/i)
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
