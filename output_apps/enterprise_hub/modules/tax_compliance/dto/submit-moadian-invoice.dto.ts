import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsObject, IsOptional, Max, Min, ValidateNested } from 'class-validator';

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
  @IsInt()
  @Min(1)
  @Max(7)
  pattern?: number;

  @ApiPropertyOptional({ description: 'Cash part in rials for a cash and credit settlement' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cashPortion?: number;

  @ApiPropertyOptional({ description: 'Article 9 late submission: registration time in ms' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lateRegistrationAt?: number;

  @ApiPropertyOptional({ type: MoadianExtrasDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoadianExtrasDto)
  extras?: MoadianExtrasDto;
}
