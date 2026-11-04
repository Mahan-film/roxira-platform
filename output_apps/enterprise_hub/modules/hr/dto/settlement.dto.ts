import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** POST /enterprise-hub/hr/employees/:id/settlement */
export class PreviewSettlementDto {
  @ApiProperty({ description: 'آخرین روز کار (میلادی، YYYY-MM-DD)', example: '2026-12-31' })
  @IsISO8601({ strict: true })
  endDate: string;

  @ApiPropertyOptional({ description: 'روزهای مرخصی استفاده‌نشده (تا دو رقم اعشار)', example: 2.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  unusedLeaveDays?: number;
}

export class SettlementParameterDto {
  @ApiProperty() key: string;
  @ApiProperty() value: number;
  @ApiProperty() version: number;
  @ApiProperty() effectiveFrom: string;
  @ApiProperty() source: string;
  @ApiProperty() verified: boolean;
  @ApiProperty({ description: 'مقدار اختصاصی سازمان، نه پیش‌فرض پلتفرم' }) tenantOverride: boolean;
}

/** All amounts are whole rials as decimal strings (they can exceed 2^53). */
export class SettlementPreviewDto {
  @ApiProperty() employeeId: number;
  @ApiProperty() hireDate: string;
  @ApiProperty() endDate: string;
  @ApiProperty() fullYears: number;
  @ApiProperty() extraDays: number;
  @ApiProperty({ description: 'مزد روزانه (ریال) = حقوق پایه قرارداد فعال ÷ روزهای مبنای ماه' }) dailyWage: string;
  @ApiProperty() unusedLeaveDays: number;
  @ApiProperty() endOfServiceBenefit: string;
  @ApiProperty() leaveSettlement: string;
  @ApiProperty() total: string;
  @ApiProperty({ type: [SettlementParameterDto] }) parameters: SettlementParameterDto[];
}
