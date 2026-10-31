import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { AllowanceTaxTreatment } from '../enums/hr.enum';

export class ContractAllowanceDto {
  @ApiProperty({ example: 'حق مسئولیت' })
  @IsString()
  @Length(1, 120)
  title: string;

  @ApiProperty({ description: 'ریال در ماه' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  amount: number;

  @ApiProperty({ description: 'مشمول بیمه' })
  @IsBoolean()
  insurable: boolean;

  @ApiProperty({ enum: AllowanceTaxTreatment })
  @IsEnum(AllowanceTaxTreatment)
  taxTreatment: AllowanceTaxTreatment;
}

/** PUT /enterprise-hub/hr/contracts/:id/allowances — the whole list. */
export class ReplaceAllowancesDto {
  @ApiProperty({ type: [ContractAllowanceDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ContractAllowanceDto)
  allowances: ContractAllowanceDto[];
}
