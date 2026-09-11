import { ApiProperty } from '@nestjs/swagger';
import { StockMovementType } from '../enums/stock-movement-type.enum';

/**
 * یک لایه مصرف‌شده/ایجادشده در گردش کالا (گزارش تفصیلی FIFO).
 */
export class MovementLayerDto {
  @ApiProperty({ description: 'شناسه دسته' })
  batchId: number;

  @ApiProperty({ description: 'شماره دسته' })
  batchNumber: string;

  @ApiProperty({ description: 'مقدار مصرف/ورود از این دسته' })
  quantity: number;

  @ApiProperty({ description: 'بهای واحد این دسته (ریال)' })
  unitPurchaseCost: number;

  @ApiProperty({ description: 'ارزش این لایه (ریال)' })
  value: number;

  @ApiProperty({ description: 'شناسه انبار دسته', nullable: true })
  warehouseId: number | null;
}

/**
 * DTO نتیجه گردش انبار (ورود یا خروج) همراه با ردیابی لایه‌های FIFO.
 */
export class StockMovementResultDto {
  @ApiProperty({ enum: StockMovementType, description: 'نوع گردش' })
  type: StockMovementType;

  @ApiProperty({ description: 'شناسه کالا (SKU)' })
  sku: string;

  @ApiProperty({ description: 'مقدار جابه‌جاشده' })
  quantity: number;

  @ApiProperty({ description: 'موجودی کالا پس از گردش' })
  quantityAfter: number;

  @ApiProperty({ description: 'بهای تمام‌شده/ارزش گردش بر پایه FIFO (ریال)' })
  totalCost: number;

  @ApiProperty({ description: 'لایه‌های FIFO درگیر در گردش', type: [MovementLayerDto] })
  layers: MovementLayerDto[];

  @ApiProperty({ description: 'زمان ثبت گردش' })
  processedAt: Date;
}
