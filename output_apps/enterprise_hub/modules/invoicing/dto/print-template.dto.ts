import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PrintDocType, PrintPaperSize } from '../enums/print-template.enum';

export class PrintColumnConfigDto {
  @ApiProperty({ description: 'کلید فنی فیلد یا ستون', example: 'description' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,64}$/, { message: 'کلید ستون فقط می‌تواند شامل حروف، اعداد، خط فاصله و زیرخط باشد' })
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

export class PrintTemplateOptionsDto {
  @ApiPropertyOptional({ description: 'یادداشت یا متن پاورقی' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  footerNote?: string;

  @ApiPropertyOptional({ description: 'تعداد ستون‌های بارکد (۴ یا ۵)' })
  @IsOptional()
  @IsIn([4, 5])
  @Type(() => Number)
  barcodeColumns?: 4 | 5;

  @ApiPropertyOptional({ description: 'نمایش قیمت در برچسب بارکد' })
  @IsOptional()
  @IsBoolean()
  showPrice?: boolean;

  @ApiPropertyOptional({ description: 'نمایش کد کالا در برچسب بارکد' })
  @IsOptional()
  @IsBoolean()
  showSku?: boolean;

  @ApiPropertyOptional({ description: 'نمایش جایگاه‌های امضا' })
  @IsOptional()
  @IsBoolean()
  showSignatures?: boolean;

  @ApiPropertyOptional({ description: 'عناوین امضاکنندگان' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  signatures?: string[];
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
  @IsNotEmpty({ message: 'عنوان قالب نمی‌تواند خالی باشد' })
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

  @ApiPropertyOptional({ description: 'آدرس تصویر لوگوی سفارشی (https یا مسیر محلی امن)' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^(https:\/\/[a-zA-Z0-9_.-]+(:[0-9]+)?(\/[^\s]*)?|data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+|\/[a-zA-Z0-9_.-]+(\/[^\s]*)?)$/, {
    message: 'آدرس لوگو باید یک URL معتبر امن (https) یا مسیر داخلی باشد',
  })
  logoUrl?: string;

  @ApiPropertyOptional({
    type: [PrintColumnConfigDto],
    description: 'تنظیمات و چیدمان ستون‌های جدول چاپ (حداکثر ۵۰ ستون)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PrintColumnConfigDto)
  columnsConfig?: PrintColumnConfigDto[];

  @ApiPropertyOptional({
    type: PrintTemplateOptionsDto,
    description: 'سایر گزینه‌های چاپ (یادداشت‌ها، ستون‌های بارکد ۴ یا ۵، امضاها)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintTemplateOptionsDto)
  options?: PrintTemplateOptionsDto;
}

export class UpdatePrintTemplateDto {
  @ApiPropertyOptional({ description: 'نام یا عنوان قالب چاپی' })
  @ValidateIf((o) => o.title !== undefined)
  @IsNotEmpty({ message: 'عنوان قالب نمی‌تواند خالی یا تهی باشد' })
  @IsString({ message: 'عنوان قالب باید رشته متنی باشد' })
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
  @Matches(/^(https:\/\/[a-zA-Z0-9_.-]+(:[0-9]+)?(\/[^\s]*)?|data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+|\/[a-zA-Z0-9_.-]+(\/[^\s]*)?)$/, {
    message: 'آدرس لوگو باید یک URL معتبر امن (https) یا مسیر داخلی باشد',
  })
  logoUrl?: string;

  @ApiPropertyOptional({
    type: [PrintColumnConfigDto],
    description: 'تنظیمات و چیدمان ستون‌ها',
  })
  @ValidateIf((o) => o.columnsConfig !== undefined)
  @IsArray({ message: 'پیکربندی ستون‌ها باید آرایه‌ای معتبر باشد' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PrintColumnConfigDto)
  columnsConfig?: PrintColumnConfigDto[];

  @ApiPropertyOptional({
    type: PrintTemplateOptionsDto,
    description: 'سایر گزینه‌های چاپ',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintTemplateOptionsDto)
  options?: PrintTemplateOptionsDto;
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

export class GetDefaultTemplateQueryDto {
  @ApiProperty({ enum: PrintDocType, description: 'نوع سند' })
  @IsEnum(PrintDocType)
  docType: PrintDocType;

  @ApiPropertyOptional({ enum: PrintPaperSize, description: 'سایز کاغذ' })
  @IsOptional()
  @IsEnum(PrintPaperSize)
  paperSize?: PrintPaperSize;
}

export class PrintTemplateResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: PrintDocType })
  docType: PrintDocType;

  @ApiPropertyOptional()
  docTypeLabel?: string;

  @ApiProperty({ enum: PrintPaperSize })
  paperSize: PrintPaperSize;

  @ApiPropertyOptional()
  paperSizeLabel?: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  isDefault: boolean;

  @ApiProperty()
  showLogo: boolean;

  @ApiPropertyOptional({ nullable: true })
  logoUrl: string | null;

  @ApiProperty({ type: [PrintColumnConfigDto] })
  columnsConfig: PrintColumnConfigDto[];

  @ApiPropertyOptional()
  options?: PrintTemplateOptionsDto;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class BarcodeLabelItemDto {
  @ApiProperty({ description: 'شناسه یا کد کالا (SKU)', example: 'SKU-10023' })
  @IsString()
  @IsNotEmpty({ message: 'کد کالا الزامی است' })
  @MaxLength(64)
  sku: string;

  @ApiProperty({ description: 'عنوان کالا', example: 'لپ‌تاپ گیمینگ ایسوس مدل G16' })
  @IsString()
  @IsNotEmpty({ message: 'عنوان کالا الزامی است' })
  @MaxLength(256)
  title: string;

  @ApiPropertyOptional({ description: 'رقم بارکد (EAN-13 یا Code128)', example: '6261234567890' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @ApiPropertyOptional({ description: 'قیمت فروش به ریال', example: '450000000' })
  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? String(value) : undefined))
  @IsString()
  @Matches(/^[0-9]+(\.[0-9]{1,2})?$/, { message: 'قیمت باید مقدار معتبر عددی به ریال باشد' })
  price?: string;

  @ApiPropertyOptional({ description: 'تعداد برچسب مورد نیاز از این کالا (حداکثر ۱۰۰)', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  count?: number;
}

export class RenderBarcodeSheetDto {
  @ApiProperty({ description: 'تعداد ستون‌های برچسب بارکد در هر صفحه A4 (۴ یا ۵)', example: 4 })
  @IsInt()
  @IsIn([4, 5])
  @Type(() => Number)
  columns: 4 | 5;

  @ApiProperty({ type: [BarcodeLabelItemDto], description: 'فهرست اقلام برای تولید شیت بارکد (حداکثر ۱۰۰ قلم)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
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
