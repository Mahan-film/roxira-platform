import { ApiProperty } from '@nestjs/swagger';

/** یک ردیف که هنگام undo به‌دلیل ارجاع‌شدن حذف نشده است. */
export class RefusedRowDto {
  @ApiProperty({ description: 'شناسه ردیف در ماژول مالک' })
  ownerId: number;

  @ApiProperty({ description: 'دلیل امتناع از حذف' })
  message: string;
}

/** خلاصه یک دسته ورود داده در `GET /batches`. */
export class BatchSummaryDto {
  @ApiProperty({ description: 'شناسه دسته' })
  batchId: string;

  @ApiProperty({ description: 'کلید موجودیت' })
  entity: string;

  @ApiProperty({ description: 'نام فایل بارگذاری‌شده' })
  fileName: string;

  @ApiProperty({ description: 'تعداد ردیف‌های درج‌شده' })
  inserted: number;

  @ApiProperty({ description: 'زمان ایجاد دسته' })
  createdAt: Date;

  @ApiProperty({ description: 'آیا این دسته بازگردانی شده است؟' })
  undone: boolean;
}

/** نتیجه بازگردانی یک دسته ورود. */
export class UndoBatchResponseDto {
  @ApiProperty({ description: 'تعداد ردیف‌های حذف‌شده' })
  removed: number;

  @ApiProperty({
    description: 'ردیف‌هایی که به‌دلیل ارجاع‌شدن حذف نشدند',
    type: [RefusedRowDto],
  })
  refused: RefusedRowDto[];
}
