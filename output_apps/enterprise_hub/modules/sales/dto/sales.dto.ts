import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsMoneyAmount } from '../../accounting/dto/money.validator';
import { Money } from '../../accounting/money';
import { SalesOrderStatus, SalesQuotationStatus } from '../enums/sales-status.enum';

export const MAX_SALES_LINES = 200;

/** Most items one availability request may ask about. */
export const MAX_AVAILABILITY_ITEMS = 200;

/**
 * Pure parser of the `itemIds` query value ("1,2,3"): positive integers only, at most
 * `MAX_AVAILABILITY_ITEMS` ids, duplicates collapse. Anything else is a 400.
 */
export function parseItemIds(raw: string | undefined): number[] {
  if (raw === undefined || raw.trim() === '') {
    throw new BadRequestException('شناسه‌های کالا (itemIds) الزامی است.');
  }
  const parts = raw.split(',');
  if (parts.length > MAX_AVAILABILITY_ITEMS) {
    throw new BadRequestException(`حداکثر ${MAX_AVAILABILITY_ITEMS} شناسه کالا مجاز است.`);
  }
  const ids: number[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (!/^\d{1,9}$/.test(text)) {
      throw new BadRequestException('شناسه‌های کالا باید اعداد صحیح مثبت و جداشده با کاما باشند.');
    }
    const id = Number(text);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

const MONEY = { oneOf: [{ type: 'number' }, { type: 'string' }], example: '100000.00' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One requested line. Quantity is a positive decimal with at most two decimals; money goes through `toMinor`. */
export class SalesLineDto {
  @ApiProperty({ description: 'شناسه کالای انبار' })
  @IsInt()
  @Min(1)
  itemId: number;

  @ApiPropertyOptional({ description: 'شرح سطر' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ description: 'مقدار (حداکثر دو رقم اعشار، مثبت)', ...MONEY })
  @IsMoneyAmount()
  quantity: number | string;

  @ApiProperty({ description: 'بهای واحد (ریال)', ...MONEY })
  @IsMoneyAmount()
  unitPrice: number | string;

  @ApiPropertyOptional({ description: 'تخفیف سطر (ریال)', ...MONEY })
  @IsOptional()
  @IsMoneyAmount()
  discount?: number | string;
}

export class CreateSalesQuotationDto {
  @ApiProperty({ description: 'کد طرف حساب (مشتری یا «both»)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  partyCode: string;

  @ApiProperty({ description: 'تاریخ پیش‌فاکتور (YYYY-MM-DD)' })
  @Matches(DATE)
  quoteDate: string;

  @ApiPropertyOptional({ description: 'اعتبار تا تاریخ (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(DATE)
  validUntil?: string;

  @ApiPropertyOptional({ description: 'یادداشت' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  note?: string;

  @ApiProperty({ type: [SalesLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SALES_LINES)
  @ValidateNested({ each: true })
  @Type(() => SalesLineDto)
  lines: SalesLineDto[];
}

/** Body of `PUT quotations/:id`: replaces the whole document while it is DRAFT. */
export class UpdateSalesQuotationDto extends CreateSalesQuotationDto {}

export class CreateSalesOrderDto {
  @ApiProperty({ description: 'کد طرف حساب (مشتری یا «both»)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  partyCode: string;

  @ApiProperty({ description: 'انبار خروج' })
  @IsInt()
  @Min(1)
  warehouseId: number;

  @ApiProperty({ description: 'تاریخ سفارش (YYYY-MM-DD)' })
  @Matches(DATE)
  orderDate: string;

  @ApiPropertyOptional({ description: 'تاریخ تحویل وعده‌شده (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(DATE)
  promisedDate?: string;

  @ApiPropertyOptional({ description: 'یادداشت' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  note?: string;

  @ApiProperty({ type: [SalesLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SALES_LINES)
  @ValidateNested({ each: true })
  @Type(() => SalesLineDto)
  lines: SalesLineDto[];
}

/** Body of `PUT orders/:id`: replaces the whole document while it is DRAFT. */
export class UpdateSalesOrderDto extends CreateSalesOrderDto {}

/** Body of `POST quotations/:id/status`. Only the transitions in `QUOTATION_TRANSITIONS` are accepted. */
export class ChangeSalesQuotationStatusDto {
  @ApiProperty({ enum: SalesQuotationStatus, description: 'حالت مقصد پیش‌فاکتور' })
  @IsIn([
    SalesQuotationStatus.DRAFT,
    SalesQuotationStatus.SENT,
    SalesQuotationStatus.ACCEPTED,
    SalesQuotationStatus.REJECTED,
    SalesQuotationStatus.CONVERTED,
  ])
  status: SalesQuotationStatus;
}

/** Body of `POST quotations/:id/convert`: the warehouse and dates of the order to create. */
export class ConvertQuotationDto {
  @ApiProperty({ description: 'انبار خروج سفارش' })
  @IsInt()
  @Min(1)
  warehouseId: number;

  @ApiProperty({ description: 'تاریخ سفارش (YYYY-MM-DD)' })
  @Matches(DATE)
  orderDate: string;

  @ApiPropertyOptional({ description: 'تاریخ تحویل وعده‌شده (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(DATE)
  promisedDate?: string;
}

export class QuerySalesQuotationDto {
  @ApiPropertyOptional({ description: 'کد طرف حساب' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional({ enum: SalesQuotationStatus })
  @IsOptional()
  @IsEnum(SalesQuotationStatus)
  status?: SalesQuotationStatus;

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

export class QuerySalesOrderDto {
  @ApiPropertyOptional({ description: 'کد طرف حساب' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional({ enum: SalesOrderStatus })
  @IsOptional()
  @IsEnum(SalesOrderStatus)
  status?: SalesOrderStatus;

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

// ---------------------------------------------------------------------- responses

export class SalesLineResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() lineNo: number;
  @ApiProperty() itemId: number;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty({ description: 'مقدار با دو رقم اعشار' }) quantity: number;
  @ApiProperty({ ...MONEY }) unitPrice: Money;
  @ApiProperty({ ...MONEY }) discount: Money;
  @ApiProperty({ ...MONEY }) lineTotal: Money;
}

export class SalesQuotationResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() number: string;
  @ApiProperty() partyCode: string;
  @ApiProperty() quoteDate: string;
  @ApiPropertyOptional({ nullable: true }) validUntil: string | null;
  @ApiProperty({ enum: SalesQuotationStatus }) status: SalesQuotationStatus;
  @ApiPropertyOptional({ nullable: true }) note: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'شناسه صورتحساب فروش تبدیل‌شده' }) convertedInvoiceId?: string | null;
  @ApiProperty({ ...MONEY }) totalAmount: Money;
  @ApiPropertyOptional({ nullable: true }) createdBy: string | null;
  @ApiPropertyOptional({ description: 'هشدار خط‌مشی' }) warning?: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiPropertyOptional({ type: [SalesLineResponseDto] }) lines?: SalesLineResponseDto[];
}

export class SalesQuotationListResponseDto {
  @ApiProperty({ type: [SalesQuotationResponseDto] }) data: SalesQuotationResponseDto[];
  @ApiProperty() total: number;
}

export class SalesOrderLineResponseDto extends SalesLineResponseDto {
  @ApiProperty({ description: 'مقدار تحویل‌شده با دو رقم اعشار' }) deliveredQuantity: number;
  @ApiProperty({ description: 'مقدار صورتحساب‌شده با دو رقم اعشار' }) invoicedQuantity: number;
}

export class SalesOrderResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() number: string;
  @ApiProperty() partyCode: string;
  @ApiPropertyOptional({ nullable: true }) quotationId: number | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty() orderDate: string;
  @ApiPropertyOptional({ nullable: true }) promisedDate: string | null;
  @ApiProperty({ enum: SalesOrderStatus }) status: SalesOrderStatus;
  @ApiPropertyOptional({ nullable: true }) note: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'شناسه صورتحساب فروش تبدیل‌شده' }) convertedInvoiceId?: string | null;
  @ApiProperty({ ...MONEY }) totalAmount: Money;
  @ApiPropertyOptional({ nullable: true }) createdBy: string | null;
  @ApiPropertyOptional({ description: 'هشدار خط‌مشی' }) warning?: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiPropertyOptional({ type: [SalesOrderLineResponseDto] }) lines?: SalesOrderLineResponseDto[];
}

export class SalesOrderListResponseDto {
  @ApiProperty({ type: [SalesOrderResponseDto] }) data: SalesOrderResponseDto[];
  @ApiProperty() total: number;
}

// ---------------------------------------------------------------------- availability

/** Query of `GET sales/availability?itemIds=1,2,3`. */
export class QueryItemAvailabilityDto {
  @ApiProperty({ description: 'شناسه‌های کالا جداشده با کاما (حداکثر ۲۰۰)' })
  @IsString()
  @MaxLength(2000)
  itemIds: string;
}

export class ItemAvailabilityResponseDto {
  @ApiProperty() itemId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'موجودی فیزیکی (on-hand)' }) onHand: number;
  @ApiProperty({ description: 'رزرو سفارش‌های تأییدشده' }) reserved: number;
  @ApiProperty({ description: 'موجودی در دسترس (on-hand منهای رزرو؛ می‌تواند منفی باشد)' }) available: number;
}

export class ItemAvailabilityListResponseDto {
  @ApiProperty({ type: [ItemAvailabilityResponseDto] }) data: ItemAvailabilityResponseDto[];
}
