import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { OnboardingStep, OnboardingStepStatus } from '../enums/onboarding-step.enum';

/** Persian and Arabic-Indic digits to Latin, then trim; an empty string becomes undefined. */
export function normaliseDigits(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const latin = value
    .trim()
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s-]/g, '');
  return latin === '' ? undefined : latin;
}

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Route parameter of `PUT /tenants/me/onboarding/steps/:step`. */
export class OnboardingStepParamDto {
  @ApiProperty({ enum: OnboardingStep })
  @IsEnum(OnboardingStep)
  step: OnboardingStep;
}

/** Body of `PUT /tenants/me/onboarding/steps/:step`. */
export class SetOnboardingStepDto {
  @ApiProperty({ enum: OnboardingStepStatus, description: 'done, skipped, or pending to reopen a step' })
  @IsEnum(OnboardingStepStatus)
  status: OnboardingStepStatus;
}

/** Body of `PUT /tenants/me/onboarding/profile` (step 1). */
export class SaveOnboardingProfileDto {
  @ApiProperty({ description: 'Company name', example: 'شرکت نمونه', minLength: 2, maxLength: 150 })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ description: 'Economic code, 11 to 14 digits', example: '411234567890' })
  @IsOptional()
  @Transform(({ value }) => normaliseDigits(value))
  @Matches(/^\d{11,14}$/, { message: 'شماره اقتصادی باید ۱۱ تا ۱۴ رقم باشد.' })
  economicCode?: string;

  @ApiPropertyOptional({ description: 'National id (10 digits for a person, 11 for a legal entity)', example: '10101234567' })
  @IsOptional()
  @Transform(({ value }) => normaliseDigits(value))
  @Matches(/^\d{10,11}$/, { message: 'شناسه ملی باید ۱۰ یا ۱۱ رقم باشد.' })
  nationalId?: string;
}

/** Body of `PATCH /tenants/me/onboarding`. */
export class UpdateOnboardingDto {
  @ApiPropertyOptional({ description: 'Hide the dashboard banner (true) or show it again (false)' })
  @IsOptional()
  @IsBoolean()
  dismissed?: boolean;

  @ApiPropertyOptional({ description: 'Record that the first-login redirect was handled; only true is accepted', enum: [true] })
  @IsOptional()
  @IsIn([true])
  firstVisitHandled?: true;
}

export class OnboardingStateDto {
  @ApiProperty({ description: 'Status of every step, in wizard order', example: { profile: 'done', fiscal_year: 'pending' } })
  steps: Record<OnboardingStep, OnboardingStepStatus>;

  @ApiProperty({ description: 'Every step is done or skipped' })
  completed: boolean;

  @ApiProperty({ description: 'The dashboard banner was dismissed' })
  dismissed: boolean;

  @ApiProperty({ description: 'The first-login redirect has not been handled yet' })
  firstVisit: boolean;

  @ApiProperty({ example: 'شرکت نمونه' })
  companyName: string;

  @ApiProperty({ nullable: true, type: String })
  economicCode: string | null;

  @ApiProperty({ nullable: true, type: String })
  nationalId: string | null;
}
