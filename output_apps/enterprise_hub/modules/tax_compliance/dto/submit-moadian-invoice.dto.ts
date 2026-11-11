import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Pattern-specific data the invoice does not hold, keyed by Moadian field name. */
export class MoadianExtrasDto {
  @ApiPropertyOptional({ description: 'Header fields such as ft, crn, billid, tinc, cdcn, cdcd, scln, scc, bpn, nti1' })
  @IsOptional()
  @IsObject()
  header?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Per line fields (same order as the invoice items): cfee, cut, exr, cpr, sovat, consfee, spro, bros, cui, ssrv, sscv, nw ...' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsObject({ each: true })
  items?: Array<Record<string, unknown>>;
}

/** Optional body of the Moadian submit call. An empty body submits a plain sale (pattern 1). */
export class SubmitMoadianInvoiceDto {
  @ApiPropertyOptional({ description: 'Pattern 1 to 7; inferred from `extras` when omitted' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'الگو باید عدد صحیح ۱ تا ۷ باشد.' })
  @Min(1, { message: 'الگو باید بین ۱ تا ۷ باشد.' })
  @Max(7, { message: 'الگو باید بین ۱ تا ۷ باشد.' })
  pattern?: number;

  @ApiPropertyOptional({ description: 'Invoice subject (1: Main, 2: Corrective, 3: Cancellation, 4: Return)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'موضوع صورتحساب باید عدد صحیح ۱ تا ۴ باشد.' })
  @Min(1, { message: 'موضوع صورتحساب باید بین ۱ تا ۴ باشد.' })
  @Max(4, { message: 'موضوع صورتحساب باید بین ۱ تا ۴ باشد.' })
  subject?: number;

  @ApiPropertyOptional({ description: 'Reference tax ID (22 chars) for corrective, cancellation, or return invoices' })
  @IsOptional()
  @IsString({ message: 'شماره منحصر‌به‌فرد مالیاتی مرجع باید رشته متنی باشد.' })
  @Length(22, 22, { message: 'شماره منحصر‌به‌فرد مالیاتی مرجع باید دقیقاً ۲۲ کاراکتر باشد.' })
  referenceTaxId?: string;

  @ApiPropertyOptional({ description: 'Cash part in rials for a cash and credit settlement' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'سهم نقدی باید عدد صحیح ریال باشد.' })
  @Min(0, { message: 'سهم نقدی نمی‌تواند منفی باشد.' })
  cashPortion?: number;

  @ApiPropertyOptional({ description: 'Article 9 late submission: registration time in ms' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'زمان ثبت دیرهنگام باید عدد صحیح میلی‌ثانیه باشد.' })
  @Min(1, { message: 'زمان ثبت دیرهنگام نامعتبر است.' })
  lateRegistrationAt?: number;

  @ApiPropertyOptional({ type: MoadianExtrasDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoadianExtrasDto)
  extras?: MoadianExtrasDto;
}
