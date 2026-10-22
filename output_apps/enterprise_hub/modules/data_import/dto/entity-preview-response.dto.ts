import { ApiProperty } from '@nestjs/swagger';
import { ImportRowFieldErrorDto } from './entity-descriptor-response.dto';

/**
 * پاسخ پیش‌نمایش ورود داده با تشخیص خودکار موجودیت
 * (POST /enterprise-hub/data-import/preview و .../:entity/preview).
 */
export class EntityPreviewResponseDto {
  @ApiProperty({ description: 'شناسه بارگذاری برای فراخوانی commit' })
  uploadId: string;

  @ApiProperty({ description: 'موجودیت تشخیص‌داده‌شده' })
  detectedEntity: string;

  @ApiProperty({ description: 'درجه اطمینان تشخیص (۰..۱)' })
  confidence: number;

  @ApiProperty({ description: 'نام ستون‌های فایل', type: [String] })
  headers: string[];

  @ApiProperty({
    description: 'نگاشت هر سربرگ به فیلد (یا null در صورت عدم تطبیق)',
    type: Object,
  })
  mapping: Record<string, string | null>;

  @ApiProperty({
    description: 'حداکثر ۵ ردیف نمونه (کلید = سربرگ)',
    type: [Object],
  })
  sampleRows: Array<Record<string, string>>;

  @ApiProperty({ description: 'تعداد کل ردیف‌های داده' })
  rowCount: number;

  @ApiProperty({ type: [ImportRowFieldErrorDto] })
  errors: ImportRowFieldErrorDto[];
}
