import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MatchStatus } from './invoice-match.domain';
import { MAX_PURCHASE_LINES } from './purchase.dto';
import { SupplierInvoiceStatus } from './supplier-invoice.repository';

const QUANTITY = /^\d+$/;
const MONEY = /^\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- requests

export class SupplierInvoiceLineDto {
  @ApiProperty({ description: 'شناسه سطر رسید کالا' })
  @IsUUID()
  receiptLineId: string;

  @ApiProperty({ description: 'مقدار صورتحساب (صدم‌های واحد)', example: '1000' })
  @IsString()
  @Matches(QUANTITY)
  quantity: string;

  @ApiProperty({ description: 'قیمت واحد صورتحساب (صدم‌های ریال)', example: '5100000' })
  @IsString()
  @Matches(MONEY)
  unitPrice: string;
}

export class CreateSupplierInvoiceDto {
  @ApiProperty({ description: 'شماره صورتحساب خود تأمین‌کننده' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  supplierRef: string;

  @ApiProperty({ description: 'تاریخ صورتحساب (YYYY-MM-DD)' })
  @Matches(DATE)
  invoiceDate: string;

  @ApiPropertyOptional({ description: 'مالیات بر ارزش افزوده (صدم‌های ریال)؛ پیش‌فرض صفر' })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  vat?: string;

  @ApiProperty({ type: [SupplierInvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PURCHASE_LINES)
  @ValidateNested({ each: true })
  @Type(() => SupplierInvoiceLineDto)
  lines: SupplierInvoiceLineDto[];
}

export class AcceptSupplierInvoiceDto {
  @ApiProperty({ description: 'دلیل پذیرش اختلاف (۳ تا ۵۰۰ نویسه)' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note: string;
}

// --------------------------------------------------------------- responses

export class SupplierInvoiceLineResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() receiptLineId: string;
  @ApiProperty() sku: string;
  @ApiProperty() quantity: string;
  @ApiProperty() unitPrice: string;
  @ApiProperty() orderValue: string;
  @ApiProperty() invoiceValue: string;
  @ApiProperty() priceDifference: string;
  @ApiProperty({ enum: ['MATCHED', 'QTY_MISMATCH', 'PRICE_MISMATCH', 'QTY_AND_PRICE_MISMATCH'] })
  matchStatus: MatchStatus;
}

export class SupplierInvoiceResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() number: string;
  @ApiPropertyOptional({ nullable: true }) orderId: string | null;
  @ApiProperty() supplierCode: string;
  @ApiProperty() supplierRef: string;
  @ApiProperty() invoiceDate: string;
  @ApiProperty({ enum: ['HELD', 'MATCHED', 'POSTED'] }) status: SupplierInvoiceStatus;
  @ApiProperty() accepted: boolean;
  @ApiPropertyOptional({ nullable: true }) acceptedBy: string | null;
  @ApiPropertyOptional({ nullable: true }) acceptedAt: Date | null;
  @ApiPropertyOptional({ nullable: true }) acceptNote: string | null;
  @ApiProperty() createdBy: string;
  @ApiProperty() vat: string;
  @ApiProperty() subtotal: string;
  @ApiProperty() total: string;
  @ApiPropertyOptional({ nullable: true }) journalEntryId: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: [SupplierInvoiceLineResponseDto] })
  lines: SupplierInvoiceLineResponseDto[];
}