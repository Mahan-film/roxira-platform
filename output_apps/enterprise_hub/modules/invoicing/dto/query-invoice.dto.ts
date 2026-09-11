import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';

/**
 * DTO فیلتر/صفحه‌بندی فهرست صورتحساب‌ها (GET /enterprise-hub/invoicing).
 */
export class QueryInvoiceDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'فیلتر بر اساس وضعیت صورتحساب', enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ description: 'جست‌وجوی جزئی در شماره صورتحساب مالیاتی' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxInvoiceNumber?: string;

  @ApiPropertyOptional({ description: 'فیلتر بر اساس ارز صورتحساب', enum: Currency })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}
