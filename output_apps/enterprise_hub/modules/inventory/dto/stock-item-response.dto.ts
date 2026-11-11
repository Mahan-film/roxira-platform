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

  @ApiProperty({ description: 'موجودی کل کالا در همه انبارها (on-hand)' })
  quantity: number;

  @ApiProperty({ description: 'رزرو سفارش‌های فروش تأییدشده (سهمی که هنوز تحویل نشده)' })
  reservedQuantity: number;

  @ApiProperty({ description: 'موجودی در دسترس (on-hand منهای رزرو؛ می‌تواند منفی باشد)' })
  availableQuantity: number;

  @ApiProperty({ description: 'آستانه حداقل موجودی' })
  minQuantity: number;

  @ApiProperty({ description: 'آیا موجودی در دسترس زیر/برابر آستانه کسری است؟' })
  isLowStock: boolean;

  @ApiProperty({ description: 'شماره دسته پیش‌فرض', nullable: true })
  batchNumber: string | null;

  @ApiProperty({ description: 'ارزش موجودی کالا بر پایه FIFO (ریال)' })
  fifoValuation: number;

  @ApiProperty({ description: 'شناسه ۱۳ رقمی کالا/خدمت مودیان (SSTID)', nullable: true })
  taxCode: string | null;
}
