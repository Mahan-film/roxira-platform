import { ApiProperty } from '@nestjs/swagger';
import { ContactChannel } from '../enums/crm.enums';

/**
 * خروجی یک سابقه تماس/تعامل مرتبط با سرنخ.
 */
export class ContactMessageResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 1, nullable: true })
  leadId: number | null;

  @ApiProperty({ example: 'سارا محمدی' })
  senderName: string;

  @ApiProperty({ example: '09121234567' })
  senderPhone: string;

  @ApiProperty({ example: 'sara@example.com', nullable: true })
  senderEmail: string | null;

  @ApiProperty({ example: 'تماس پیگیری پیش‌فاکتور' })
  subject: string;

  @ApiProperty({ example: 'مشتری خواستار تخفیف حجمی ۵٪ شد.' })
  message: string;

  @ApiProperty({ enum: ContactChannel, nullable: true, example: ContactChannel.PHONE })
  channel: ContactChannel | null;

  @ApiProperty({ example: '2026-09-11T10:00:00.000Z' })
  createdAt: Date;
}

/**
 * خروجی صفحه‌بندی‌شده سوابق تماس.
 */
export class PaginatedContactMessagesResponseDto {
  @ApiProperty({ type: [ContactMessageResponseDto] })
  data: ContactMessageResponseDto[];

  @ApiProperty({ example: 3 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
