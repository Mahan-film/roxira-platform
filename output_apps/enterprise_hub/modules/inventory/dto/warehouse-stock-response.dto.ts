import { ApiProperty } from '@nestjs/swagger';

/**
 * یک ردیف موجودی به تفکیک کالا در یک انبار مشخص.
 */
export class WarehouseStockRowDto {
  @ApiProperty({ description: 'شناسه کالا (SKU)' })
  sku: string;

  @ApiProperty({ description: 'نام کالا' })
  name: string;

  @ApiProperty({ description: 'مقدار موجود در این انبار' })
  quantity: number;

  @ApiProperty({ description: 'ارزش موجودی این کالا در انبار (ریال)' })
  fifoValue: number;

  @ApiProperty({ description: 'تعداد لایه‌های FIFO باز در این انبار' })
  openBatchCount: number;
}

/**
 * DTO استعلام موجودی یک انبار مشخص.
 */
export class WarehouseStockResponseDto {
  @ApiProperty({ description: 'شناسه انبار' })
  warehouseId: number;

  @ApiProperty({ description: 'نام انبار' })
  warehouseName: string;

  @ApiProperty({ description: 'کد مکانی انبار' })
  locationCode: string;

  @ApiProperty({ description: 'ارزش کل موجودی این انبار (ریال)' })
  totalValue: number;

  @ApiProperty({ description: 'تعداد اقلام موجود در انبار' })
  itemCount: number;

  @ApiProperty({ description: 'ردیف‌های موجودی', type: [WarehouseStockRowDto] })
  rows: WarehouseStockRowDto[];
}
