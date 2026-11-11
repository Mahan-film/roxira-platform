import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isNotEqual', async: false })
export class IsNotEqualConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    const [relatedPropertyName] = args.constraints;
    const relatedValue = (args.object as any)[relatedPropertyName];
    return value !== relatedValue;
  }

  defaultMessage(args: ValidationArguments) {
    const [relatedPropertyName] = args.constraints;
    return `${args.property} must not equal ${relatedPropertyName}`;
  }
}

@ValidatorConstraint({ name: 'isIanaTimezone', async: false })
export class IsIanaTimezoneConstraint implements ValidatorConstraintInterface {
  validate(value: any) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value.trim() });
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage() {
    return 'Timezone must be a valid IANA timezone identifier (e.g. Asia/Tehran)';
  }
}

export class LoginTimeWindowDto {
  @ApiProperty({ description: 'Day of week: 0 (Sun) to 6 (Sat)', minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ description: 'Start time in minutes from midnight (0..1439)', minimum: 0, maximum: 1439 })
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute: number;

  @ApiProperty({ description: 'End time in minutes from midnight (0..1439)', minimum: 0, maximum: 1439 })
  @IsInt()
  @Min(0)
  @Max(1439)
  @Validate(IsNotEqualConstraint, ['startMinute'])
  endMinute: number;
}

export class SetLoginScheduleDto {
  @ApiPropertyOptional({ description: 'IANA Timezone name e.g. Asia/Tehran', default: 'Asia/Tehran' })
  @ValidateIf((_obj: unknown, val: unknown) => val !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'timezone cannot be empty or null' })
  @IsString()
  @Validate(IsIanaTimezoneConstraint)
  timezone?: string;

  @ApiPropertyOptional({ description: 'Whether login schedule is enforced', default: true })
  @IsOptional()
  @IsBoolean()
  enforceSchedule?: boolean;

  @ApiProperty({ type: [LoginTimeWindowDto], description: 'Permitted weekly login time windows' })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LoginTimeWindowDto)
  windows: LoginTimeWindowDto[];
}
