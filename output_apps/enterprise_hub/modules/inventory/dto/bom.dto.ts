import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProductionOrderStatus } from '../entities/production-order.entity';

export class CreateBomItemDto {
  @ApiProperty({ description: 'کد کالای جزء / ماده اولیه (SKU)' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  componentSku: string;

  @ApiPropertyOptional({ description: 'شناسه فرمول ساخت فرعی برای ساختار چندسطحی' })
  @IsOptional()
  @IsInt()
  @Min(1)
  subBomId?: number;

  @ApiProperty({ description: 'مقدار خالص مصرف به ازای هر واحد خروجی فرمول' })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false })
  @Min(0.001)
  @Max(999999999)
  quantity: number;

  @ApiPropertyOptional({ description: 'درصد ضایعات مورد انتظار (۰ تا ۱۰۰)', default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  wastePercent?: number;

  @ApiPropertyOptional({ description: 'یادداشت یا توضیحات ردیف' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateBomDto {
  @ApiProperty({ description: 'کد یکتای فرمول ساخت (BOM Code)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  bomCode: string;

  @ApiProperty({ description: 'نام یا عنوان فرمول ساخت' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({ description: 'کد کالای ساخته‌شده نهایی (Finished SKU)' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  finishedItemSku: string;

  @ApiPropertyOptional({ description: 'تعداد محصول نهایی خروجی (پیش‌فرض ۱)', default: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false })
  @Min(0.001)
  @Max(999999999)
  outputQuantity?: number;

  @ApiPropertyOptional({ description: 'شماره ویرایش فرمول ساخت', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({ description: 'یادداشت یا توضیحات کلی' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [CreateBomItemDto], description: 'فهرست مواد اولیه و قطعات' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateBomItemDto)
  items: CreateBomItemDto[];
}

export class ExplodeBomDto {
  @ApiProperty({ description: 'مقدار محصول نهایی درخواستی برای ریزش مواد' })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false })
  @Min(0.001)
  @Max(999999999)
  quantity: number;
}

export class CreateProductionOrderDto {
  @ApiProperty({ description: 'شماره یکتای سفارش تولید' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  orderNumber: string;

  @ApiProperty({ description: 'شناسه فرمول ساخت (BOM ID)' })
  @IsInt()
  @Min(1)
  bomId: number;

  @ApiPropertyOptional({ description: 'شناسه انبار مبدا مواد اولیه' })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number;

  @ApiProperty({ description: 'تعداد برنامه‌ریزی‌شده جهت تولید' })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false })
  @Min(0.001)
  @Max(999999999)
  plannedQuantity: number;

  @ApiPropertyOptional({ description: 'توضیحات سفارش تولید' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CompleteProductionOrderDto {
  @ApiProperty({ description: 'تعداد تولیدشده نهایی' })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false })
  @Min(0.001)
  @Max(999999999)
  completedQuantity: number;

  @ApiPropertyOptional({ description: 'شناسه انبار مقصد کالای ساخته‌شده' })
  @IsOptional()
  @IsInt()
  @Min(1)
  destinationWarehouseId?: number;
}

export class QueryProductionOrdersDto {
  @ApiPropertyOptional({ enum: ProductionOrderStatus, description: 'فیلتر وضعیت سفارش تولید' })
  @IsOptional()
  @IsEnum(ProductionOrderStatus)
  status?: ProductionOrderStatus;
}
