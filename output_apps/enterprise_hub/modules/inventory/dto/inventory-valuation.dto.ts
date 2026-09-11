import { ApiProperty } from '@nestjs/swagger';

/**
 * یک ردیف از گزارش ارزش موجودی بر پایه FIFO.
 */
export class FifoValuationRowDto {
  @ApiProperty({ description: 'شناسه کالا (SKU)' })
  sku: string;

  @ApiProperty({ description: 'نام کالا' })
  name: string;

  @ApiProperty({ description: 'موجودی کل کالا' })
  quantity: number;

  @ApiProperty({ description: 'موجودی ثبت‌شده در لایه‌های FIFO' })
  batchQuantity: number;

  @ApiProperty({ description: 'ارزش موجودی بر پایه لایه‌های FIFO (ریال)' })
  fifoValue: number;

  @ApiProperty({ description: 'میانگین بهای واحد موزون (ریال)' })
  weightedAverageUnitCost: number;

  @ApiProperty({ description: 'تعداد لایه‌های FIFO باز' })
  openBatchCount: number;

  @ApiProperty({ description: 'آیا کالا دچار کسری است؟' })
  isLowStock: boolean;
}

/**
 * DTO گزارش تجمیعی ارزش موجودی انبار بر پایه FIFO.
 */
export class FifoValuationResponseDto {
  @ApiProperty({ description: 'تعداد کالاهای دارای موجودی' })
  itemCount: number;

  @ApiProperty({ description: 'تعداد کالاهای دچار کسری' })
  lowStockCount: number;

  @ApiProperty({ description: 'ارزش کل موجودی انبارها (ریال)' })
  totalInventoryValue: number;

  @ApiProperty({ description: 'تعداد کل لایه‌های FIFO باز' })
  totalOpenBatches: number;

  @ApiProperty({ description: 'ردیف‌های ارزش‌گذاری', type: [FifoValuationRowDto] })
  rows: FifoValuationRowDto[];
}
