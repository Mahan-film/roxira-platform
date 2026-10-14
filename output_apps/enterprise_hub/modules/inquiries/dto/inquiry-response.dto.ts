import { ApiProperty } from '@nestjs/swagger';
import { InquiryStatus } from '../enums/inquiry-status.enum';

/** خروجی یک درخواست سازمانی. */
export class InquiryResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ nullable: true, example: null, description: 'NULL یعنی درخواست عمومی' })
  tenantId: string | null;

  @ApiProperty({ example: 'سارا محمدی' })
  name: string;

  @ApiProperty({ nullable: true, example: 'شرکت فناوری روکسیرا' })
  company: string | null;

  @ApiProperty({ nullable: true, example: '09121234567' })
  phone: string | null;

  @ApiProperty({ nullable: true, example: 'sara@example.com' })
  email: string | null;

  @ApiProperty({ nullable: true })
  message: string | null;

  @ApiProperty({ nullable: true, example: 'home-early-access' })
  source: string | null;

  @ApiProperty({ enum: InquiryStatus, example: InquiryStatus.NEW })
  status: InquiryStatus;

  @ApiProperty({ example: '2026-10-14T12:00:00.000Z' })
  createdAt: Date;
}

/** فهرست صفحه‌بندی‌شده درخواست‌های سازمانی. */
export class PaginatedInquiriesResponseDto {
  @ApiProperty({ type: [InquiryResponseDto] })
  data: InquiryResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
