import { ApiProperty, OmitType } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { JournalEntryStatus } from '../enums/accounting.enum';
import { CreateJournalEntryDto } from './create-journal-entry.dto';

/** Body of `PUT journal-entries/:id`: replaces a DRAFT or TEMPORARY voucher. The state is kept. */
export class UpdateJournalEntryDto extends OmitType(CreateJournalEntryDto, ['status'] as const) {}

/** Body of `POST journal-entries/:id/status`. A final (POSTED) voucher never changes state. */
export class ChangeVoucherStatusDto {
  @ApiProperty({
    enum: [JournalEntryStatus.DRAFT, JournalEntryStatus.TEMPORARY, JournalEntryStatus.POSTED],
    description: 'حالت مقصد: DRAFT، TEMPORARY یا POSTED (قطعی‌سازی، بدون بازگشت).',
  })
  @IsIn([JournalEntryStatus.DRAFT, JournalEntryStatus.TEMPORARY, JournalEntryStatus.POSTED])
  status: JournalEntryStatus;
}
