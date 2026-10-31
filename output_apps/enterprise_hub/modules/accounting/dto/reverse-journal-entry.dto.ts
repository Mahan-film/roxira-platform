import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body of `POST journal-entries/:id/reverse`. */
export class ReverseJournalEntryDto {
  @ApiPropertyOptional({ description: 'تاریخ سند برگشتی (ISO 8601)؛ پیش‌فرض اکنون' })
  @IsOptional()
  @IsISO8601()
  date?: string;

  @ApiPropertyOptional({ description: 'دلیل برگشت', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
