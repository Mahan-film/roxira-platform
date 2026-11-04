import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const MAX_OPENING_LINES = 20000;

export class CreateOpeningDraftDto {
  @ApiProperty({ description: 'انبار موجودی اول دوره' })
  @IsInt()
  @Min(1)
  toWarehouseId: number;

  @ApiProperty({ description: 'تاریخ مبنای موجودی (YYYY-MM-DD)؛ لایه‌ها با این تاریخ ساخته می‌شوند' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  docDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  note?: string;
}

export class OpeningLineDto {
  @ApiProperty({ description: 'کد کالا (SKU)' })
  @IsString()
  @MaxLength(64)
  sku: string;

  @ApiProperty({ description: 'مقدار شمارش‌شده؛ فقط مقدار واقعی، نه حدس' })
  @IsNumber({ maxDecimalPlaces: 2 })
  quantity: number;

  @ApiProperty({ description: 'بهای واحد از سند یا انبارگردانی؛ برای مقدار مثبت الزامی است' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCost: number;
}

export class ReplaceOpeningLinesDto {
  @ApiProperty({ type: [OpeningLineDto], description: 'همهٔ سطرها؛ جایگزین سطرهای قبلی می‌شود' })
  @IsArray()
  @ArrayMaxSize(MAX_OPENING_LINES)
  @ValidateNested({ each: true })
  @Type(() => OpeningLineDto)
  lines: OpeningLineDto[];
}

export class PostOpeningDto {
  @ApiProperty({ description: 'تعداد سطرهایی که در بازبینی دیدید' })
  @IsInt()
  @Min(1)
  lineCount: number;

  @ApiProperty({ description: 'جمع ارزش سطرهایی که در بازبینی دیدید' })
  @IsNumber({ maxDecimalPlaces: 2 })
  totalValue: number;
}

export type OpeningProblemCode =
  | 'UNKNOWN_SKU'
  | 'DUPLICATE_SKU'
  | 'BAD_QUANTITY'
  | 'MISSING_COST'
  | 'ALREADY_HAS_STOCK';

export class OpeningProblemDto {
  @ApiProperty() sku: string;
  @ApiProperty({ enum: ['UNKNOWN_SKU', 'DUPLICATE_SKU', 'BAD_QUANTITY', 'MISSING_COST', 'ALREADY_HAS_STOCK'] })
  code: OpeningProblemCode;
  @ApiProperty() message: string;
}

export class OpeningReviewDto {
  @ApiProperty() documentId: number;
  @ApiProperty() docNumber: string;
  @ApiProperty({ enum: ['DRAFT', 'POSTED'] }) status: 'DRAFT' | 'POSTED';
  @ApiProperty() docDate: string;
  @ApiProperty() warehouseId: number;
  @ApiProperty() lineCount: number;
  @ApiProperty({ description: 'جمع ارزش = مجموع مقدار × بها' }) totalValue: number;
  @ApiProperty({ description: 'کالاهای فهرست که هنوز موجودی ندارند و در این سند نیامده‌اند' })
  itemsStillWithoutStock: number;
  @ApiProperty({ type: [OpeningProblemDto] }) problems: OpeningProblemDto[];
  @ApiProperty({ description: 'بازبینی روی سطرهای فعلی انجام شده است' }) reviewed: boolean;
  @ApiProperty({ description: 'می‌توان ثبت نهایی کرد' }) canPost: boolean;
}
