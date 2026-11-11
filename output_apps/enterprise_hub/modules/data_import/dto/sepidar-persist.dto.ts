import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional } from 'class-validator';

export class PersistSepidarDto {
  @ApiPropertyOptional({ description: 'آیا از داده‌های تستی و ساختگی سپیدار استفاده شود؟', default: true })
  @IsOptional()
  @IsBoolean()
  useSynthetic?: boolean;

  @ApiPropertyOptional({ description: 'فهرست خام حساب‌های سپیدار' })
  @IsOptional()
  @IsArray()
  accounts?: any[];

  @ApiPropertyOptional({ description: 'فهرست خام طرف‌حساب‌های سپیدار' })
  @IsOptional()
  @IsArray()
  parties?: any[];

  @ApiPropertyOptional({ description: 'فهرست خام کالاهای سپیدار' })
  @IsOptional()
  @IsArray()
  items?: any[];

  @ApiPropertyOptional({ description: 'فهرست خام سطرهای سند افتتاحیه سپیدار' })
  @IsOptional()
  @IsArray()
  openingVoucher?: any[];

  @ApiPropertyOptional({ description: 'فهرست خام چک‌های سپیدار' })
  @IsOptional()
  @IsArray()
  cheques?: any[];
}
