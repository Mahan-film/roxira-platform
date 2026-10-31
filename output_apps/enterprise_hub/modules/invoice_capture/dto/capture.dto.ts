import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CAPTURE_MAX_FIELD_CHARS,
  CAPTURE_MAX_ITEMS,
  CAPTURE_MAX_TEXT_CHARS,
  CAPTURE_MIN_CONFIDENCE_FLOOR,
} from '../constants/capture.constants';

const AMOUNT = /^\d{1,16}(\.\d{1,2})?$/;
const QTY = /^\d{1,9}(\.\d{1,3})?$/;

/** Multipart body of `POST capture/documents` (the file itself is the `file` part). */
export class CreateCaptureDto {
  @ApiPropertyOptional({ description: 'توضیح کاربر یا متن فاکتور', maxLength: CAPTURE_MAX_TEXT_CHARS })
  @IsOptional()
  @IsString()
  @MaxLength(CAPTURE_MAX_TEXT_CHARS)
  text?: string;

  @ApiPropertyOptional({ enum: ['purchase', 'sales'], description: 'نوع فاکتور اگر کاربر می‌داند' })
  @IsOptional()
  @IsIn(['purchase', 'sales'])
  kind?: 'purchase' | 'sales';
}

export class DraftItemDto {
  @ApiProperty() @IsString() @MaxLength(CAPTURE_MAX_FIELD_CHARS) description: string;
  @ApiProperty({ example: '2' }) @IsString() @Matches(QTY) quantity: string;
  @ApiProperty({ example: '1500000.00' }) @IsString() @Matches(AMOUNT) unitPrice: string;
  @ApiProperty({ example: '3000000.00' }) @IsString() @Matches(AMOUNT) total: string;
  @ApiPropertyOptional({ nullable: true, description: 'کد حساب دفتر کل (باید در دفتر سازمان باشد)' })
  @IsOptional() @IsString() @MaxLength(32) accountCode?: string | null;
}

/** Edited draft (`PATCH capture/documents/:id`); validated again on the server. */
export class UpdateDraftDto {
  @ApiProperty({ enum: ['purchase', 'sales'] }) @IsIn(['purchase', 'sales']) kind: 'purchase' | 'sales';
  @ApiProperty() @IsString() @MaxLength(CAPTURE_MAX_FIELD_CHARS) sellerName: string;
  @ApiProperty() @IsString() @MaxLength(16) sellerTaxId: string;
  @ApiProperty() @IsString() @MaxLength(CAPTURE_MAX_FIELD_CHARS) buyerName: string;
  @ApiProperty() @IsString() @MaxLength(16) buyerTaxId: string;
  @ApiProperty() @IsString() @MaxLength(64) invoiceNumber: string;
  @ApiProperty({ nullable: true, example: '2026-10-31' })
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string | null;
  @ApiProperty({ example: 'IRR' }) @IsString() @Matches(/^[A-Z]{3}$/) currency: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @Matches(/^\d{1,12}(\.\d{1,6})?$/) fxRate: string | null;
  @ApiProperty({ type: [DraftItemDto] })
  @IsArray() @ArrayMaxSize(CAPTURE_MAX_ITEMS) @ValidateNested({ each: true }) @Type(() => DraftItemDto)
  items: DraftItemDto[];
  @ApiProperty() @IsString() @Matches(AMOUNT) subtotal: string;
  @ApiProperty() @IsString() @Matches(AMOUNT) tax: string;
  @ApiProperty() @IsString() @Matches(AMOUNT) total: string;
  @ApiProperty() @IsBoolean() paid: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class ReverseCaptureDto {
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** Tenant auto-mode settings (admin only). */
export class UpdateSettingsDto {
  @ApiProperty({ description: 'ثبت خودکار (پیش‌فرض خاموش)' }) @IsBoolean() autoEnabled: boolean;
  @ApiProperty({ minimum: CAPTURE_MIN_CONFIDENCE_FLOOR, maximum: 1 })
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(CAPTURE_MIN_CONFIDENCE_FLOOR) @Max(1) minConfidence: number;
  @ApiProperty({ description: 'سقف هزینه روزانه مدل (دلار)' })
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) dailyCostCapUsd: number;
  @ApiProperty({ description: 'سقف تعداد سند در روز' })
  @IsInt() @Min(1) @Max(10_000) dailyDocCap: number;
}

/** Vendor rule (admin only). */
export class UpsertVendorRuleDto {
  @ApiProperty({ description: 'کد حساب دفتر کل برای این فروشنده' }) @IsString() @MaxLength(32) accountCode: string;
  @ApiProperty() @IsBoolean() autoPost: boolean;
  @ApiProperty({ description: 'سقف مبلغ (ریال) برای ثبت خودکار', example: '50000000.00' })
  @IsString() @Matches(AMOUNT) maxAmountIrr: string;
}
