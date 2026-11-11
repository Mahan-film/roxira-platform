import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PrintDocType, PrintPaperSize } from '../enums/print-template.enum';

export class PrintColumnConfigDto {
  @ApiProperty({ description: 'کلید فنی فیلد یا ستون', example: 'description' })
  @IsString()
  @MaxLength(64)
  key: string;

  @ApiProperty({ description: 'عنوان نمایشی ستون در فرم چاپی', example: 'شرح کالا یا خدمات' })
  @IsString()
  @MaxLength(128)
  label: string;

  @ApiProperty({ description: 'نمایش ستون در چاپ', example: true })
  @IsBoolean()
  visible: boolean;

  @ApiProperty({ description: 'ترتیب نمایش ستون (از ۱ به بعد)', example: 1 })
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  order: number;

  @ApiPropertyOptional({ description: 'عرض پیشنهادی ستون بر حسب درصد', example: 25 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  widthPercent?: number;
}

export class CreatePrintTemplateDto {
  @ApiProperty({
    enum: PrintDocType,
    description: 'نوع سند (فاکتور فروش، سند خزانه‌داری، حواله انبار، برچسب بارکد)',
    example: PrintDocType.SALES_INVOICE,
  })
  @IsEnum(PrintDocType)
  docType: PrintDocType;

  @ApiProperty({
    enum: PrintPaperSize,
    description: 'اندازه کاغذ (A4, A5, THERMAL_80MM)',
    example: PrintPaperSize.A4,
  })
  @IsEnum(PrintPaperSize)
  paperSize: PrintPaperSize;

  @ApiProperty({ description: 'نام یا عنوان قالب چاپی', example: 'قالب رسمی فاکتور فروش شرکتی' })
  @IsString()
  @MaxLength(128)
  title: string;

  @ApiPropertyOptional({ description: 'تنظیم به عنوان قالب پیش‌فرض این نوع سند', default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'نمایش لوگوی سازمان در سربرگ', default: true })
  @IsOptional()
  @IsBoolean()
  showLogo?: boolean;

  @ApiPropertyOptional({ description: 'آدرس تصویر لوگوی سفارشی' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  logoUrl?: string;

  @ApiPropertyOptional({
    type: [PrintColumnConfigDto],
    description: 'تنظیمات و چیدمان ستون‌های جدول چاپ',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrintColumnConfigDto)
  columnsConfig?: PrintColumnConfigDto[];

  @ApiPropertyOptional({
    description: 'سایر گزینه‌های چاپ (یادداشت‌ها، ستون‌های بارکد ۴ یا ۵، امضاها)',
    example: { barcodeColumns: 4, showPrice: true, headerNotes: 'توضیحات سربرگ' },
  })
  @IsOptional()
  options?: Record<string, any>;
}

export class UpdatePrintTemplateDto {
  @ApiPropertyOptional({ description: 'نام یا عنوان قالب چاپی' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string;

  @ApiPropertyOptional({ description: 'تنظیم به عنوان قالب پیش‌فرض' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'نمایش لوگوی سازمان در سربرگ' })
  @IsOptional()
  @IsBoolean()
  showLogo?: boolean;

  @ApiPropertyOptional({ description: 'آدرس تصویر لوگو' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  logoUrl?: string;

  @ApiPropertyOptional({
    type: [PrintColumnConfigDto],
    description: 'تنظیمات و چیدمان ستون‌ها',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrintColumnConfigDto)
  columnsConfig?: PrintColumnConfigDto[];

  @ApiPropertyOptional({ description: 'سایر گزینه‌های چاپ' })
  @IsOptional()
  options?: Record<string, any>;
}

export class QueryPrintTemplateDto {
  @ApiPropertyOptional({ enum: PrintDocType, description: 'فیلتر بر اساس نوع سند' })
  @IsOptional()
  @IsEnum(PrintDocType)
  docType?: PrintDocType;

  @ApiPropertyOptional({ enum: PrintPaperSize, description: 'فیلتر بر اساس سایز کاغذ' })
  @IsOptional()
  @IsEnum(PrintPaperSize)
  paperSize?: PrintPaperSize;
}

export class PrintTemplateResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: PrintDocType })
  docType: PrintDocType;

  @ApiProperty()
  docTypeLabel: string;

  @ApiProperty({ enum: PrintPaperSize })
  paperSize: PrintPaperSize;

  @ApiProperty()
  paperSizeLabel: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  isDefault: boolean;

  @ApiProperty()
  showLogo: boolean;

  @ApiPropertyOptional()
  logoUrl?: string | null;

  @ApiProperty({ type: [PrintColumnConfigDto] })
  columnsConfig: PrintColumnConfigDto[];

  @ApiProperty()
  options: Record<string, any>;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class BarcodeLabelItemDto {
  @ApiProperty({ description: 'کد کالا یا کد SKU', example: 'PRD-1001' })
  @IsString()
  @MaxLength(64)
  sku: string;

  @ApiProperty({ description: 'عنوان کالا', example: 'لپ‌تاپ گیمینگ ایسوس مدل G16' })
  @IsString()
  @MaxLength(256)
  title: string;

  @ApiPropertyOptional({ description: 'رقم بارکد (EAN-13 یا Code128)', example: '6261234567890' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @ApiPropertyOptional({ description: 'قیمت فروش به ریال', example: 450_000_000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @ApiPropertyOptional({ description: 'تعداد برچسب مورد نیاز از این کالا', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  count?: number;
}

export class RenderBarcodeSheetDto {
  @ApiProperty({ description: 'تعداد ستون‌های برچسب بارکد در هر صفحه A4 (۴ یا ۵)', example: 4 })
  @IsInt()
  @IsIn([4, 5])
  @Type(() => Number)
  columns: 4 | 5;

  @ApiProperty({ type: [BarcodeLabelItemDto], description: 'فهرست اقلام برای تولید شیت بارکد' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BarcodeLabelItemDto)
  items: BarcodeLabelItemDto[];

  @ApiPropertyOptional({ description: 'نمایش قیمت مصرف‌کننده در برچسب', default: true })
  @IsOptional()
  @IsBoolean()
  showPrice?: boolean;

  @ApiPropertyOptional({ description: 'نمایش کد کالا در برچسب', default: true })
  @IsOptional()
  @IsBoolean()
  showSku?: boolean;
}
