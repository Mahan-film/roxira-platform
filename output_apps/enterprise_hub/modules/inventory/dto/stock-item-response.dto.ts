import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO خروجی کالای انبار همراه با وضعیت هشدار کسری.
 */
export class StockItemResponseDto {
  @ApiProperty({ description: 'شناسه کالا' })
  id: number;

  @ApiProperty({ description: 'شناسه یکتای کالا (SKU)' })
  sku: string;

  @ApiProperty({ description: 'بارکد کالا' })
  barcode: string;

  @ApiProperty({ description: 'نام کالا' })
  name: string;

  @ApiProperty({ description: 'موجودی کل کالا در همه انبارها' })
  quantity: number;

  @ApiProperty({ description: 'آستانه حداقل موجودی' })
  minQuantity: number;

  @ApiProperty({ description: 'آیا موجودی زیر/برابر آستانه کسری است؟' })
  isLowStock: boolean;

  @ApiProperty({ description: 'شماره دسته پیش‌فرض', nullable: true })
  batchNumber: string | null;

  @ApiProperty({ description: 'ارزش موجودی کالا بر پایه FIFO (ریال)' })
  fifoValuation: number;
}
