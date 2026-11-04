import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const NON_NEGATIVE = /^\d{1,16}(\.\d{1,2})?$/;
const amount = (what: string) => ({ message: `${what} باید عدد غیرمنفی (ریال) باشد.` });

/** Inputs of the rental income tax preview (Art. 53 and the Art. 57 exemption). Amounts in rials, exact decimal strings. */
export class RentalTaxPreviewDto {
  @ApiProperty({ example: 1405 })
  @Type(() => Number)
  @IsInt()
  @Min(1300)
  @Max(1600)
  fiscalYear: number;

  @ApiProperty({ description: 'Rent received in the year, cash and in kind', example: '600000000' })
  @IsString()
  @Matches(NON_NEGATIVE, amount('اجاره‌بهای دریافتی'))
  rentReceived: string;

  @ApiPropertyOptional({ description: 'Art. 53 notes 5 and 6: value of improvements and owner costs paid by the tenant, already valued; the 50% uplift of note 5 is applied by the caller', example: '0' })
  @IsOptional()
  @IsString()
  @Matches(NON_NEGATIVE, amount('درآمد غیرنقدی'))
  inKindIncome?: string;

  @ApiProperty({ description: 'false when the lessor is not the owner: the taxable income is rent received minus rent paid' })
  @IsBoolean()
  lessorIsOwner: boolean;

  @ApiPropertyOptional({ description: 'Rent the lessor pays for the property (when lessorIsOwner is false)', example: '0' })
  @IsOptional()
  @IsString()
  @Matches(NON_NEGATIVE, amount('اجاره‌بهای پرداختی'))
  rentPaid?: string;

  @ApiPropertyOptional({ description: 'GROSS rent the accountant excludes (owner residence, note 11 area exemption ...), removed before the cost share', example: '0' })
  @IsOptional()
  @IsString()
  @Matches(NON_NEGATIVE, amount('اجارهٔ معاف'))
  exemptRentPortion?: string;

  @ApiPropertyOptional({ description: 'Other taxable income of the year (default 0); decides how much of the Art. 57 exemption is left', example: '0' })
  @IsOptional()
  @IsString()
  @Matches(NON_NEGATIVE, amount('سایر درآمد مشمول مالیات'))
  otherTaxableIncome?: string;

  @ApiPropertyOptional({ description: 'Minor child under the father guardianship: Art. 57 note 1, no exemption' })
  @IsOptional()
  @IsBoolean()
  minorUnderGuardianship?: boolean;
}
