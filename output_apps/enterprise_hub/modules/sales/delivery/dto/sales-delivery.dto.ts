import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsMoneyAmount } from '../../../accounting/dto/money.validator';
import { Money } from '../../../accounting/money';
import { FulfilmentStatus } from '../delivery-math';

/** Most lines one delivery note may carry (same ceiling as quotations and orders). */
export const MAX_DELIVERY_LINES = 200;

const MONEY = { oneOf: [{ type: 'number' }, { type: 'string' }], example: '100000.00' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One requested line: an order line id and how much of it leaves the warehouse now. */
export class DeliveryLineDto {
  @ApiProperty({ description: 'شناسه سطر سفارش' })
  @IsInt()
  @Min(1)
  orderLineId: number;

  @ApiProperty({ description: 'مقدار تحویل (حداکثر دو رقم اعشار، مثبت)' })
  @IsMoneyAmount()
  quantity: number | string;
}

/** Body of `POST orders/:id/deliveries`. */
export class CreateSalesDeliveryDto {
  @ApiProperty({ description: 'تاریخ تحویل (YYYY-MM-DD)' })
  @Matches(DATE)
  deliveryDate: string;

  @ApiPropertyOptional({ description: 'کلید ایدمپوتنسی (تکرار همان کلید همان حواله را برمی‌گرداند)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'یادداشت سند انبار' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  note?: string;

  @ApiProperty({ type: [DeliveryLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DELIVERY_LINES)
  @ValidateNested({ each: true })
  @Type(() => DeliveryLineDto)
  lines: DeliveryLineDto[];
}

/** Query of `GET deliveries`. */
export class QuerySalesDeliveryDto {
  @ApiPropertyOptional({ description: 'فقط حواله‌های این سفارش' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderId?: number;

  @ApiPropertyOptional({ description: 'کد طرف حساب' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

/** Query of `GET backorders`. */
export class QueryBackordersDto {
  @ApiPropertyOptional({ description: 'فقط خطوط باز این طرف حساب' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;
}

// ---------------------------------------------------------------------- responses

export class SalesDeliveryLineResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() lineNo: number;
  @ApiProperty() orderLineId: number;
  @ApiProperty() itemId: number;
  @ApiProperty() sku: string;
  @ApiProperty({ description: 'مقدار تحویل با دو رقم اعشار' }) quantity: number;
  @ApiProperty({ ...MONEY }) lineCost: Money;
  @ApiProperty({ ...MONEY, description: 'بهای واحد سطر' }) unitCost: Money;
}

export class SalesDeliveryResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() number: string;
  @ApiProperty() orderId: number;
  @ApiProperty() partyCode: string;
  @ApiProperty() warehouseId: number;
  @ApiProperty() deliveryDate: string;
  @ApiProperty() status: string;
  @ApiProperty({ ...MONEY, description: 'جمع بهای تمام‌شده سطرها' }) totalCost: Money;
  @ApiPropertyOptional({ nullable: true }) stockDocumentId: number | null;
  @ApiPropertyOptional({ nullable: true }) journalEntryId: number | null;
  @ApiPropertyOptional({ nullable: true }) createdBy: string | null;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ type: [SalesDeliveryLineResponseDto] }) lines?: SalesDeliveryLineResponseDto[];
}

export class SalesDeliveryListResponseDto {
  @ApiProperty({ type: [SalesDeliveryResponseDto] }) data: SalesDeliveryResponseDto[];
  @ApiProperty() total: number;
}

export class OrderFulfilmentLineResponseDto {
  @ApiProperty() orderLineId: number;
  @ApiProperty() itemId: number;
  @ApiProperty({ description: 'مقدار سفارش‌شده' }) ordered: number;
  @ApiProperty({ description: 'مقدار تحویل‌شده' }) delivered: number;
  @ApiProperty({ description: 'مقدار بازمانده (backorder)' }) backorder: number;
  @ApiProperty({ enum: ['NONE', 'PARTIAL', 'COMPLETE'] }) status: FulfilmentStatus;
}

export class OrderFulfilmentResponseDto {
  @ApiProperty() orderId: number;
  @ApiProperty({ enum: ['NONE', 'PARTIAL', 'COMPLETE'] }) status: FulfilmentStatus;
  @ApiProperty({ type: [OrderFulfilmentLineResponseDto] }) lines: OrderFulfilmentLineResponseDto[];
}

export class BackorderRowResponseDto {
  @ApiProperty() orderId: number;
  @ApiProperty() orderNumber: string;
  @ApiProperty() partyCode: string;
  @ApiProperty() itemId: number;
  @ApiProperty({ description: 'مقدار بازمانده با دو رقم اعشار' }) backorder: number;
}

export class BackorderListResponseDto {
  @ApiProperty({ type: [BackorderRowResponseDto] }) data: BackorderRowResponseDto[];
  @ApiProperty() total: number;
}
