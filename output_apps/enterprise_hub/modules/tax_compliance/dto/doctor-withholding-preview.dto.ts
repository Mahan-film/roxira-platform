import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, MinLength, Min, ValidateNested,
} from 'class-validator';

const NON_NEGATIVE = /^\d{1,16}(\.\d{1,2})?$/;
export const DOCTOR_PAYMENT_KINDS = ['FEE', 'SALARY', 'BONUS'] as const;
export type DoctorPaymentKind = (typeof DOCTOR_PAYMENT_KINDS)[number];

export class DoctorPaymentDto {
  @ApiProperty({ example: '2026-06-01', description: 'Payment date (or the date the fee was accrued/offset), YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'تاریخ پرداخت باید به صورت YYYY-MM-DD باشد.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'تاریخ پرداخت باید به صورت YYYY-MM-DD باشد.' })
  paidOn: string;

  @ApiProperty({ example: '500000000', description: 'Gross amount in rials' })
  @IsString()
  @Matches(NON_NEGATIVE, { message: 'مبلغ باید عدد غیرمنفی (ریال) باشد.' })
  amount: string;

  @ApiProperty({ description: 'Your reference for the doctor (not a national id)', maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  doctorRef: string;

  @ApiProperty({ enum: DOCTOR_PAYMENT_KINDS, description: 'FEE: fee of a non-employed doctor. SALARY and BONUS (karaneh) are outside this withholding' })
  @IsIn(DOCTOR_PAYMENT_KINDS, { message: 'نوع پرداخت باید FEE، SALARY یا BONUS باشد.' })
  kind: DoctorPaymentKind;
}

/** Inputs of the doctors' fee advance withholding preview. */
export class DoctorWithholdingPreviewDto {
  @ApiProperty({ example: 1405 })
  @Type(() => Number)
  @IsInt()
  @Min(1300)
  @Max(1600)
  fiscalYear: number;

  @ApiProperty({ type: [DoctorPaymentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DoctorPaymentDto)
  payments: DoctorPaymentDto[];

  @ApiPropertyOptional({ description: 'Date the withheld tax was (or will be) paid to the Tax Organization: late-penalty preview' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'تاریخ ایصال باید به صورت YYYY-MM-DD باشد.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'تاریخ ایصال باید به صورت YYYY-MM-DD باشد.' })
  remittedOn?: string;
}
