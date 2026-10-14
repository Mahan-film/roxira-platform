import { ApiProperty } from '@nestjs/swagger';

/** منبع نگاشت پیشنهادی: مدل زبانی یا نگاشت قطعی مترادف‌ها. */
export type MappingSource = 'llm' | 'fallback';

/**
 * پاسخ پیش‌نمایش ورود سرنخ‌ها
 * (POST /enterprise-hub/data-import/crm-leads/preview).
 */
export class PreviewResponseDto {
  @ApiProperty({ description: 'شناسه بارگذاری برای فراخوانی commit' })
  uploadId: string;

  @ApiProperty({ description: 'نام ستون‌های فایل', type: [String] })
  headers: string[];

  @ApiProperty({
    description: 'حداکثر ۵ ردیف نمونه برای بازبینی نگاشت',
    type: [[String]],
  })
  sampleRows: string[][];

  @ApiProperty({
    description: 'نگاشت پیشنهادی: نام ستون مبدأ ← فیلد سرنخ CRM',
    type: Object,
    example: { 'نام مشتری': 'fullName', 'موبایل': 'phone' },
  })
  mapping: Record<string, string>;

  @ApiProperty({
    description: 'منبع نگاشت: llm یا fallback (نگاشت قطعی مترادف‌ها)',
    enum: ['llm', 'fallback'],
  })
  mappingSource: MappingSource;

  @ApiProperty({ description: 'تعداد کل ردیف‌های داده فایل' })
  totalRows: number;
}
