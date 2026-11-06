import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ContractInsuranceType, ContractSide, ContractStatus } from '../enums/contracting.enum';
import { DATE_ONLY, MONEY_STRING } from './project.dto';

export class CreateContractDto {
  @ApiProperty({ description: 'کد قرارداد (یکتا در هر سازمان)', example: 'K-1405-01' })
  @IsString() @MinLength(1) @MaxLength(64) @Matches(/^[^\s]+$/, { message: 'کد قرارداد نباید فاصله داشته باشد.' })
  code: string;

  @ApiProperty({ description: 'عنوان قرارداد' })
  @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/, { message: 'عنوان قرارداد نباید خالی باشد.' })
  title: string;

  @ApiProperty({ enum: ContractSide, description: 'employer: ما کارفرماییم؛ contractor: ما پیمانکاریم' })
  @IsEnum(ContractSide)
  side: ContractSide;

  @ApiProperty({ description: 'کد طرف حساب (پیمانکار یا کارفرما)' })
  @IsString() @MinLength(1) @MaxLength(64)
  partyCode: string;

  @ApiPropertyOptional({ description: 'شناسه پروژه' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  projectId?: number;

  @ApiProperty({ description: 'تاریخ قرارداد (YYYY-MM-DD)' })
  @IsISO8601({ strict: true }) @Matches(DATE_ONLY)
  contractDate: string;

  @ApiProperty({ description: 'مبلغ قرارداد (ریال، رشته اعشاری)', example: '500000000' })
  @IsString() @Matches(MONEY_STRING, { message: 'مبلغ معتبر نیست.' })
  amount: string;

  @ApiPropertyOptional({ description: 'مبلغ پیش‌پرداخت' })
  @IsOptional() @IsString() @Matches(MONEY_STRING, { message: 'مبلغ معتبر نیست.' })
  advanceAmount?: string;

  @ApiPropertyOptional({ enum: ContractInsuranceType })
  @IsOptional() @IsEnum(ContractInsuranceType)
  insuranceType?: ContractInsuranceType;
}

/** `code`, `side` and `partyCode` are never updatable. */
export class UpdateContractDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/, { message: 'عنوان قرارداد نباید خالی باشد.' })
  title?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  projectId?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) @Matches(DATE_ONLY)
  contractDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(MONEY_STRING, { message: 'مبلغ معتبر نیست.' })
  amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(MONEY_STRING, { message: 'مبلغ معتبر نیست.' })
  advanceAmount?: string;
  @ApiPropertyOptional({ enum: ContractInsuranceType }) @IsOptional() @IsEnum(ContractInsuranceType)
  insuranceType?: ContractInsuranceType;
  @ApiPropertyOptional({ enum: ContractStatus }) @IsOptional() @IsEnum(ContractStatus)
  status?: ContractStatus;
}

export class QueryContractsDto {
  @ApiPropertyOptional({ enum: ContractSide }) @IsOptional() @IsEnum(ContractSide)
  side?: ContractSide;
  @ApiPropertyOptional({ enum: ContractStatus }) @IsOptional() @IsEnum(ContractStatus)
  status?: ContractStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  projectId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64)
  partyCode?: string;
  @ApiPropertyOptional({ description: 'جست‌وجو در کد یا عنوان' }) @IsOptional() @IsString() @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit: number = 50;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset: number = 0;
}

export class ContractResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ContractSide }) side: ContractSide;
  @ApiProperty() partyCode: string;
  @ApiPropertyOptional({ nullable: true, type: Number }) projectId: number | null;
  @ApiProperty() contractDate: string;
  @ApiProperty({ type: Object }) amount: number | string;
  @ApiProperty({ type: Object }) advanceAmount: number | string;
  @ApiPropertyOptional({ enum: ContractInsuranceType, nullable: true }) insuranceType: ContractInsuranceType | null;
  @ApiProperty({ enum: ContractStatus }) status: ContractStatus;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ContractListResponseDto {
  @ApiProperty({ type: [ContractResponseDto] }) data: ContractResponseDto[];
  @ApiProperty() total: number;
}
