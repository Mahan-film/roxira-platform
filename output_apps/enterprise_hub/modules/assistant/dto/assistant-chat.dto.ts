import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  ASSISTANT_MAX_HISTORY,
  ASSISTANT_MAX_MESSAGE_CHARS,
} from '../constants/assistant.constants';

/** یک پیام قبلی گفت‌وگو (فقط متن؛ نتایج ابزار هرگز از کلاینت پذیرفته نمی‌شود). */
export class AssistantHistoryMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({ maxLength: ASSISTANT_MAX_MESSAGE_CHARS })
  @IsString()
  @MaxLength(ASSISTANT_MAX_MESSAGE_CHARS)
  content: string;
}

/**
 * بدنه درخواست دستیار (POST /enterprise-hub/assistant/chat).
 * هیچ فیلد مستأجری ندارد؛ سازمان فقط از توکن JWT خوانده می‌شود.
 */
export class AssistantChatDto {
  @ApiProperty({
    description: 'پرسش کاربر به فارسی',
    example: 'فروش ماه گذشته چقدر بود؟',
    maxLength: ASSISTANT_MAX_MESSAGE_CHARS,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ASSISTANT_MAX_MESSAGE_CHARS)
  message: string;

  @ApiPropertyOptional({
    type: [AssistantHistoryMessageDto],
    maxItems: ASSISTANT_MAX_HISTORY,
    description: 'پیام‌های قبلی همین گفت‌وگو (اختیاری)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ASSISTANT_MAX_HISTORY)
  @ValidateNested({ each: true })
  @Type(() => AssistantHistoryMessageDto)
  history?: AssistantHistoryMessageDto[];
}
