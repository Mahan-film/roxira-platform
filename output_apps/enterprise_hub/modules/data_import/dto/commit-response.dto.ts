import { ApiProperty } from '@nestjs/swagger';

/** خطای یک ردیف در هنگام ورود داده. */
export class ImportRowErrorDto {
  @ApiProperty({ description: 'شماره ردیف در فایل (سربرگ = ۱)' })
  row: number;

  @ApiProperty({ description: 'دلیل رد شدن ردیف' })
  reason: string;
}

/**
 * نتیجه نهایی ورود سرنخ‌ها
 * (POST /enterprise-hub/data-import/crm-leads/commit).
 */
export class CommitResponseDto {
  @ApiProperty({ description: 'تعداد ردیف‌های درج‌شده' })
  imported: number;

  @ApiProperty({ description: 'تعداد ردیف‌های تکراری رد‌شده (بر پایه ایمیل)' })
  skipped: number;

  @ApiProperty({
    description: 'خطاهای اعتبارسنجی (حداکثر ۵۰ مورد)',
    type: [ImportRowErrorDto],
  })
  errors: ImportRowErrorDto[];
}
