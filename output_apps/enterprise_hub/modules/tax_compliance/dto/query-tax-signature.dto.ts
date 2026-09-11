import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  TAX_SIGNATURE_PAGE_SIZE_DEFAULT,
  TAX_SIGNATURE_PAGE_SIZE_MAX,
} from '../constants/tax-compliance.constants';
import { TaxSubmissionStatus } from '../enums/tax-compliance.enum';

/**
 * DTO فیلتر/صفحه‌بندی فهرست بسته‌های امضاشده مالیاتی.
 */
export class QueryTaxSignatureDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    default: TAX_SIGNATURE_PAGE_SIZE_DEFAULT,
    minimum: 1,
    maximum: TAX_SIGNATURE_PAGE_SIZE_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAX_SIGNATURE_PAGE_SIZE_MAX)
  limit: number = TAX_SIGNATURE_PAGE_SIZE_DEFAULT;

  @ApiPropertyOptional({ description: 'فیلتر وضعیت ارسال مالیاتی', enum: TaxSubmissionStatus })
  @IsOptional()
  @IsEnum(TaxSubmissionStatus)
  status?: TaxSubmissionStatus;

  @ApiPropertyOptional({ description: 'جست‌وجوی جزئی در شماره صورتحساب' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxInvoiceNumber?: string;

  @ApiPropertyOptional({ description: 'شناسه صورتحساب (UUID)' })
  @IsOptional()
  @IsUUID('4')
  invoiceId?: string;

  @ApiPropertyOptional({ description: 'شناسه یکتای مالیاتی ۲۲ رقمی' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  taxId?: string;
}
