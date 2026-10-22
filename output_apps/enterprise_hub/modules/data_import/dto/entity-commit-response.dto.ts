import { ApiProperty } from '@nestjs/swagger';

/** خطای یک ردیف در هنگام ورود نهایی. */
export class EntityCommitRowErrorDto {
  @ApiProperty({ description: 'شماره ردیف فایل (سربرگ = ۱)' })
  row: number;

  @ApiProperty({ description: 'دلیل رد شدن ردیف' })
  message: string;
}

/**
 * نتیجه ورود نهایی یک موجودیت
 * (POST /enterprise-hub/data-import/commit).
 */
export class EntityCommitResponseDto {
  @ApiProperty({ description: 'شناسه دسته ورود برای undo' })
  batchId: string;

  @ApiProperty({ description: 'تعداد ردیف‌های درج‌شده' })
  inserted: number;

  @ApiProperty({ description: 'تعداد ردیف‌های تکراری رد‌شده' })
  skippedDuplicates: number;

  @ApiProperty({
    description: 'ردیف‌های ناموفق (اعتبارسنجی یا درج)',
    type: [EntityCommitRowErrorDto],
  })
  failed: EntityCommitRowErrorDto[];
}
