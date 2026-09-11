import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO خروجی یک دسته (لایه) FIFO.
 */
export class FifoBatchResponseDto {
  @ApiProperty({ description: 'شناسه دسته' })
  id: number;

  @ApiProperty({ description: 'شناسه کالا (SKU)' })
  sku: string;

  @ApiProperty({ description: 'شماره دسته' })
  batchNumber: string;

  @ApiProperty({ description: 'مقدار باقی‌مانده در دسته' })
  quantityRemaining: number;

  @ApiProperty({ description: 'بهای خرید واحد (ریال)' })
  unitPurchaseCost: number;

  @ApiProperty({ description: 'ارزش باقی‌مانده دسته (ریال)' })
  remainingValue: number;

  @ApiProperty({ description: 'تاریخ دریافت دسته' })
  receivedDate: Date;

  @ApiProperty({ description: 'شناسه انبار محل نگهداری', nullable: true })
  warehouseId: number | null;

  @ApiProperty({ description: 'نام انبار محل نگهداری', nullable: true })
  warehouseName: string | null;
}
