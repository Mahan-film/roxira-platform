import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { StockDocumentStatus, StockDocumentType } from '../enums/stock-document.enum';

export const MAX_DOCUMENT_LINES = 500;

export class TransferLineDto {
  @ApiProperty({ description: 'شناسه کالا (SKU)', example: 'SKU-1001' })
  @IsString()
  @MaxLength(64)
  sku: string;

  @ApiProperty({ description: 'مقدار منتقل‌شده', example: 5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;
}

export class CreateTransferDto {
  @ApiProperty({ description: 'انبار مبدأ' })
  @IsInt()
  @Min(1)
  fromWarehouseId: number;

  @ApiProperty({ description: 'انبار مقصد' })
  @IsInt()
  @Min(1)
  toWarehouseId: number;

  @ApiPropertyOptional({ description: 'تاریخ سند (YYYY-MM-DD)؛ پیش‌فرض امروز' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  docDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  note?: string;

  @ApiProperty({ type: [TransferLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DOCUMENT_LINES)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines: TransferLineDto[];
}

export class QueryStockDocumentDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ enum: StockDocumentType })
  @IsOptional()
  @IsEnum(StockDocumentType)
  docType?: StockDocumentType;

  @ApiPropertyOptional({ description: 'اسناد مربوط به یک انبار (مبدأ یا مقصد)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId?: number;
}

export class StockDocumentLineResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() sku: string;
  @ApiProperty() quantity: number;
  @ApiProperty() unitCost: number;
  @ApiProperty() value: number;
  @ApiProperty({ nullable: true }) batchNumber: string | null;
}

export class StockDocumentResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() docNumber: string;
  @ApiProperty({ enum: StockDocumentType }) docType: StockDocumentType;
  @ApiProperty({ enum: StockDocumentStatus }) status: StockDocumentStatus;
  @ApiProperty() docDate: string;
  @ApiProperty({ nullable: true }) fromWarehouseId: number | null;
  @ApiProperty({ nullable: true }) toWarehouseId: number | null;
  @ApiProperty({ nullable: true }) reference: string | null;
  @ApiProperty({ nullable: true }) note: string | null;
  @ApiProperty({ nullable: true }) sourceInvoiceId: string | null;
  @ApiProperty({ nullable: true }) journalEntryId: number | null;
  @ApiProperty({ nullable: true }) createdBy: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ description: 'جمع ارزش خطوط' }) totalValue: number;
  @ApiPropertyOptional({ type: [StockDocumentLineResponseDto] }) lines?: StockDocumentLineResponseDto[];
}
