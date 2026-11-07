import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { JournalEntryStatus } from '../enums/accounting.enum';
import { CreateJournalEntryDto } from './create-journal-entry.dto';

/**
 * Body of `PUT journal-entries/:id`: replaces a DRAFT or TEMPORARY voucher. The state is kept.
 * `expectedVersion` is optional for internal callers; the UI sends the version it loaded so a
 * concurrent edit is refused with 409 instead of overwriting.
 */
export class UpdateJournalEntryDto extends OmitType(CreateJournalEntryDto, ['status'] as const) {
  @ApiPropertyOptional({
    description:
      'نسخهٔ خوانده‌شدهٔ سند؛ با ارسال آن، ویرایش فقط اگر نسخه هنوز همین باشد اعمال می‌شود و در غیر این صورت 409 برمی‌گردد.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

/** Body of `POST journal-entries/:id/status`. A final (POSTED) voucher never changes state. */
export class ChangeVoucherStatusDto {
  @ApiProperty({
    enum: [JournalEntryStatus.DRAFT, JournalEntryStatus.TEMPORARY, JournalEntryStatus.POSTED],
    description: 'حالت مقصد: DRAFT، TEMPORARY یا POSTED (قطعی‌سازی، بدون بازگشت).',
  })
  @IsIn([JournalEntryStatus.DRAFT, JournalEntryStatus.TEMPORARY, JournalEntryStatus.POSTED])
  status: JournalEntryStatus;

  @ApiPropertyOptional({
    description:
      'نسخهٔ خوانده‌شدهٔ سند؛ با ارسال آن، تغییر وضعیت فقط اگر نسخه هنوز همین باشد اعمال می‌شود و در غیر این صورت 409 برمی‌گردد.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
