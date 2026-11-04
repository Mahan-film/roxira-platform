import { ApiProperty } from '@nestjs/swagger';

/** یک فراخوانی ابزار که برای پاسخ استفاده شد (برای شفافیت در رابط کاربری). */
export class AssistantToolCallDto {
  @ApiProperty({ example: 'invoicing_sales_summary' })
  name: string;

  @ApiProperty({
    description: 'آرگومان‌هایی که مدل به ابزار داد',
    type: 'object',
    additionalProperties: true,
  })
  arguments: Record<string, unknown>;

  @ApiProperty({ description: 'آیا ابزار بدون خطا اجرا شد؟' })
  ok: boolean;

  @ApiProperty({ description: 'خطای ابزار (در صورت وجود)', nullable: true })
  error: string | null;
}

/** پاسخ دستیار. */
export class AssistantChatResponseDto {
  @ApiProperty({ description: 'پاسخ نهایی به فارسی' })
  answer: string;

  @ApiProperty({ type: [AssistantToolCallDto] })
  toolCalls: AssistantToolCallDto[];

  @ApiProperty({ description: 'مدلی که پاسخ نهایی را داد', nullable: true })
  model: string | null;

  @ApiProperty({
    description: 'true اگر پاسخ مدل به‌خاطر عدد بدون شاهد رد و دستیار پرهیز کرد',
  })
  abstained: boolean;

  @ApiProperty({
    type: [String],
    description: 'عددهای بدون شاهدی که باعث پرهیز شدند (فقط وقتی پرهیز شده)',
  })
  unverifiedNumbers: string[];
}
