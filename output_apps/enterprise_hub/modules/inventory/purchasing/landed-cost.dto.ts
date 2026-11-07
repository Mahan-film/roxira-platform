import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LandedCostBasis, LandedCostCategory } from './landed-cost.domain';

/** API money is an integer string of bigint minor units (rial x 100). */
const MONEY = /^\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------ requests

export class CreateLandedCostDto {
  @ApiProperty({ enum: LandedCostCategory, description: 'دسته هزینه سربار' })
  @IsEnum(LandedCostCategory)
  category: LandedCostCategory;

  @ApiProperty({ description: 'مبلغ هزینه (صدم‌های ریال)', example: '1000000' })
  @IsString()
  @Matches(MONEY)
  amount: string;

  @ApiProperty({ enum: LandedCostBasis, description: 'مبنای تخصیص' })
  @IsEnum(LandedCostBasis)
  basis: LandedCostBasis;

  @ApiProperty({ description: 'تاریخ هزینه (YYYY-MM-DD)' })
  @Matches(DATE)
  date: string;

  @ApiProperty({ description: 'کد تأمین‌کننده' })
  @IsString()
  @MaxLength(64)
  supplierCode: string;

  @ApiProperty({ description: 'ارجاع سند هزینه (شماره بارنامه، اظهارنامه و ...)' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  reference: string;

  @ApiPropertyOptional({ description: 'کلید یکتای تکرارناپذیری در هر سازمان' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

// ----------------------------------------------------------------- responses

export class LandedCostAllocationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() receiptLineId: string;
  @ApiProperty() sku: string;
  @ApiProperty({ description: 'مقدار سطر رسید (صدم‌های واحد)' }) quantity: string;
  @ApiProperty({ description: 'وزن تخصیص بر مبنای انتخابی' }) basisValue: string;
  @ApiProperty({ description: 'سهم تخصیص‌یافته (صدم‌های ریال)' }) share: string;
  @ApiProperty({ description: 'سهم افزوده‌شده به لایه موجودی' }) toInventory: string;
  @ApiProperty({ description: 'سهم ارسال‌شده به بهای تمام‌شده فروش' }) toCogs: string;
  @ApiPropertyOptional({ nullable: true }) fifoBatchId: number | null;
}

export class LandedCostResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() receiptId: string;
  @ApiProperty({ enum: LandedCostCategory }) category: LandedCostCategory;
  @ApiProperty({ enum: LandedCostBasis }) basis: LandedCostBasis;
  @ApiProperty() amount: string;
  @ApiProperty() date: string;
  @ApiProperty() supplierCode: string;
  @ApiProperty() reference: string;
  @ApiPropertyOptional({ nullable: true }) idempotencyKey: string | null;
  @ApiProperty() createdBy: string;
  @ApiProperty() inventoryAmount: string;
  @ApiProperty() cogsAmount: string;
  @ApiPropertyOptional({ nullable: true }) journalEntryId: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: [LandedCostAllocationResponseDto] })
  allocations: LandedCostAllocationResponseDto[];
}
