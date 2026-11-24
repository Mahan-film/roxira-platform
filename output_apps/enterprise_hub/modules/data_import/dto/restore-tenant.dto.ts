import { IsBoolean, IsNotEmpty, IsObject, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantGoBDZ3Archive } from '../services/tenant-export.service';

export class RestoreTenantDto {
  @ApiPropertyOptional({
    description: 'اعتبارسنجی ساختار، چک‌سام‌ها و ارجاعات بدون ذخیره در دیتابیس (Dry Run)',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value, obj }) => {
    // Lesson 26: preserve boolean values against implicit coercion
    const raw = obj?.dryRun ?? value;
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  })
  dryRun?: boolean;

  @ApiPropertyOptional({
    description: 'اجازه بازیابی در مستأجری که از قبل دارای اسناد حسابداری است',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value, obj }) => {
    const raw = obj?.allowNonEmptyTenant ?? value;
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  })
  allowNonEmptyTenant?: boolean;

  @ApiProperty({
    description: 'بسته خروجی استخراج‌شده شامل مانیفست و فایل‌های تفکیک‌شده GoBD Z3 / JSON',
  })
  @IsObject()
  @IsNotEmpty()
  archive: TenantGoBDZ3Archive;
}
