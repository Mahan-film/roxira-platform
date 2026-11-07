import { ApiProperty } from '@nestjs/swagger';

/** One attachment of a journal entry, as returned by upload and list. Bytes are never in the body. */
export class VoucherAttachmentResponseDto {
  @ApiProperty({ description: 'شناسه پیوست', example: 12 })
  id: number;

  @ApiProperty({ description: 'شناسه سند', example: 1043 })
  journalEntryId: number;

  @ApiProperty({ description: 'نام فایل (پاک‌سازی‌شده)', example: 'receipt.pdf' })
  fileName: string;

  @ApiProperty({ description: 'نوع محتوا', example: 'application/pdf' })
  contentType: string;

  @ApiProperty({ description: 'حجم فایل به بایت', example: 28451 })
  sizeBytes: number;

  @ApiProperty({ description: 'کاربر بارگذار', example: 'u-1024' })
  uploadedBy: string;

  @ApiProperty({ description: 'زمان بارگذاری (ISO 8601)', example: '2026-11-06T09:30:00.000Z' })
  createdAt: string;
}
