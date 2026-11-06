import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PurchaseOrderStatus,
  PurchaseRequestStatus,
} from './purchase.types';

/** API quantities are integer strings of the bigint hundredths ("1000" = 10.00). */
const QUANTITY = /^\d+$/;
/** API money is an integer string of bigint minor units (rial x 100). */
const MONEY = /^\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_PURCHASE_LINES = 500;

// ----------------------------------------------------------------- requests

export class PurchaseRequestLineDto {
  @ApiProperty({ description: 'کد کالا (SKU)' })
  @IsString()
  @MaxLength(64)
  sku: string;

  @ApiProperty({ description: 'مقدار (صدم‌های واحد؛ "1000" یعنی ۱۰٫۰۰)', example: '1000' })
  @IsString()
  @Matches(QUANTITY)
  quantity: string;
}

export class CreatePurchaseRequestDto {
  @ApiProperty({ type: [PurchaseRequestLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PURCHASE_LINES)
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequestLineDto)
  lines: PurchaseRequestLineDto[];
}

export class ConvertPurchaseRequestDto {
  @ApiProperty({ description: 'کد تأمین‌کننده' })
  @IsString()
  @MaxLength(64)
  supplierCode: string;

  @ApiPropertyOptional({ description: 'شناسه انبار' })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number;

  @ApiProperty({ description: 'تاریخ سفارش (YYYY-MM-DD)' })
  @Matches(DATE)
  orderDate: string;

  @ApiProperty({
    description: 'قیمت واحد هر SKU به صدم‌های ریال (bigint minor units)',
    example: { A: '5000000' },
  })
  @IsObject()
  prices: Record<string, string>;
}

// ------------------------------------------------------------------- orders

export class PurchaseOrderLineDto {
  @ApiProperty({ description: 'کد کالا (SKU)' })
  @IsString()
  @MaxLength(64)
  sku: string;

  @ApiProperty({ description: 'مقدار (صدم‌های واحد)', example: '1000' })
  @IsString()
  @Matches(QUANTITY)
  quantity: string;

  @ApiProperty({ description: 'قیمت واحد (صدم‌های ریال)', example: '5000000' })
  @IsString()
  @Matches(MONEY)
  unitPrice: string;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ description: 'کد تأمین‌کننده' })
  @IsString()
  @MaxLength(64)
  supplierCode: string;

  @ApiPropertyOptional({ description: 'شناسه انبار' })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number;

  @ApiProperty({ description: 'تاریخ سفارش (YYYY-MM-DD)' })
  @Matches(DATE)
  orderDate: string;

  @ApiProperty({ type: [PurchaseOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PURCHASE_LINES)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines: PurchaseOrderLineDto[];
}

export class QueryPurchaseOrdersDto {
  @ApiPropertyOptional({ enum: PurchaseOrderStatus })
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;
}

// ----------------------------------------------------------------- receipts

export class GoodsReceiptLineDto {
  @ApiProperty({ description: 'شناسه سطر سفارش' })
  @IsUUID()
  orderLineId: string;

  @ApiProperty({ description: 'مقدار دریافتی (صدم‌های واحد)', example: '400' })
  @IsString()
  @Matches(QUANTITY)
  quantity: string;

  @ApiPropertyOptional({ description: 'وزن (هزارم کیلوگرم) برای هزینه‌های حمل' })
  @IsOptional()
  @IsString()
  @Matches(QUANTITY)
  weight?: string;
}

export class CreateGoodsReceiptDto {
  @ApiProperty({ type: [GoodsReceiptLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PURCHASE_LINES)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines: GoodsReceiptLineDto[];

  @ApiPropertyOptional({ description: 'کلید یکتای تکرارناپذیری در هر سازمان' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'زمان دریافت (ISO 8601)؛ پیش‌فرض اکنون' })
  @IsOptional()
  @IsISO8601()
  receivedAt?: string;
}

export class QueryPurchaseReceiptsDto {
  @ApiPropertyOptional({ description: 'فقط رسیدهای یک سفارش' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

// ----------------------------------------------------------------- settings

export class UpdatePurchaseSettingsDto {
  @ApiPropertyOptional({ description: 'تحمل اضافه‌دریافت (بیس‌پوینت، ۰ تا ۱۰۰۰۰)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  overReceiptToleranceBp?: number;

  @ApiPropertyOptional({ description: 'تحمل اختلاف قیمت (بیس‌پوینت، ۰ تا ۱۰۰۰۰)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  priceToleranceBp?: number;

  @ApiPropertyOptional({ description: 'تحمل اختلاف قیمت مطلق هر سطر (صدم‌های ریال)' })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  priceToleranceAbs?: string;
}

// ---------------------------------------------------------------- responses

export class PurchaseRequestLineResponseDto {
  @ApiProperty() sku: string;
  @ApiProperty() quantity: string;
}

export class PurchaseRequestResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() number: string;
  @ApiProperty({ enum: PurchaseRequestStatus }) status: PurchaseRequestStatus;
  @ApiProperty() requestedBy: string;
  @ApiProperty({ type: [PurchaseRequestLineResponseDto] }) lines: PurchaseRequestLineResponseDto[];
  @ApiPropertyOptional({ nullable: true }) orderId: string | null;
  @ApiProperty() createdAt: Date;
}

export class PurchaseOrderLineResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() sku: string;
  @ApiProperty() quantity: string;
  @ApiProperty() unitPrice: string;
  @ApiProperty() receivedQuantity: string;
}

export class PurchaseOrderResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() number: string;
  @ApiProperty() supplierCode: string;
  @ApiProperty({ enum: PurchaseOrderStatus }) status: PurchaseOrderStatus;
  @ApiPropertyOptional({ nullable: true }) warehouseId: number | null;
  @ApiProperty({ type: [PurchaseOrderLineResponseDto] }) lines: PurchaseOrderLineResponseDto[];
  @ApiPropertyOptional({ nullable: true }) requestId: string | null;
  @ApiProperty() orderDate: string;
  @ApiPropertyOptional({ nullable: true }) approvedBy: string | null;
  @ApiPropertyOptional({ nullable: true }) approvedAt: Date | null;
  @ApiProperty() createdAt: Date;
}

export class GoodsReceiptLineResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() orderLineId: string;
  @ApiProperty() sku: string;
  @ApiProperty() quantity: string;
  @ApiProperty() unitCost: string;
  @ApiProperty() value: string;
  @ApiPropertyOptional({ nullable: true }) weight: string | null;
  @ApiPropertyOptional({ nullable: true }) fifoBatchId: number | null;
}

export class GoodsReceiptResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() number: string;
  @ApiProperty() orderId: string;
  @ApiProperty() supplierCode: string;
  @ApiProperty() receivedAt: Date;
  @ApiProperty() receivedBy: string;
  @ApiPropertyOptional({ nullable: true }) idempotencyKey: string | null;
  @ApiProperty({ type: [GoodsReceiptLineResponseDto] }) lines: GoodsReceiptLineResponseDto[];
  @ApiProperty() totalValue: string;
  @ApiPropertyOptional({ nullable: true }) journalEntryId: string | null;
}

export class PurchaseSettingsResponseDto {
  @ApiProperty() overReceiptToleranceBp: number;
  @ApiProperty() priceToleranceBp: number;
  @ApiProperty() priceToleranceAbs: string;
}