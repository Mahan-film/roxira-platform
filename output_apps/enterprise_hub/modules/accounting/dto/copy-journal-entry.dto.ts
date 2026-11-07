import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Body of `POST journal-entries/:id/copy`. Only the date of the new draft is caller-controlled;
 * it defaults to today and, when given, must be a calendar day outside locked periods and closed
 * fiscal years (checked by the normal create path).
 */
export class CopyJournalEntryDto {
  @ApiPropertyOptional({
    description: 'تاریخ سند کپی (ISO 8601)؛ در صورت عدم ارسال، تاریخ امروز استفاده می‌شود.',
    example: '2026-09-11',
  })
  @IsOptional()
  @IsISO8601()
  date?: string;
}
