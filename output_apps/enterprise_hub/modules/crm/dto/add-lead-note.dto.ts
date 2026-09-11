import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_NOTE_LENGTH } from '../constants/crm.constants';

/**
 * DTO ثبت یادداشت روی سرنخ
 * (POST /enterprise-hub/crm/leads/:id/notes).
 *
 * یادداشت با مُهر زمانی به انتهای سابقه یادداشت‌های سرنخ افزوده می‌شود.
 */
export class AddLeadNoteDto {
  @ApiProperty({
    description: 'متن یادداشت',
    example: 'بودجه مشتری برای فصل بعد تأیید شد.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NOTE_LENGTH)
  note: string;
}
