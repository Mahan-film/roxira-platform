import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CustomerGroup } from '../enums/customer-group.enum';
import { PartyRole } from '../enums/party-role.enum';

/** Iranian national id: exactly 10 or 11 digits. */
const NATIONAL_ID = /^\d{10,11}$/;
/** Iranian economic (registration) code: 10 to 14 digits. */
const ECONOMIC_CODE = /^\d{10,14}$/;
/** E.164-ish phone: optional leading +, then 8 to 15 digits. */
const PHONE = /^\+?\d{8,15}$/;
/** Credit limit amount in Rial: non-negative integer or decimal with at most 2 fractional digits. */
const CREDIT_LIMIT = /^\d+(\.\d{1,2})?$/;

export class CreatePartyDto {
  @ApiProperty({ description: 'کد طرف حساب (یکتا در هر سازمان)', example: 'C-100' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[^\s]+$/, { message: 'کد طرف حساب نباید فاصله داشته باشد.' })
  code: string;

  @ApiProperty({ description: 'نام طرف حساب' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: 'نام طرف حساب نباید خالی باشد.' })
  name: string;

  @ApiProperty({ enum: PartyRole })
  @IsEnum(PartyRole)
  role: PartyRole;

  @ApiPropertyOptional({ description: 'شناسه ملی / کد ملی (۱۰ یا ۱۱ رقم)', example: '12345678901' })
  @IsOptional()
  @IsString()
  @Matches(NATIONAL_ID)
  nationalId?: string;

  @ApiPropertyOptional({ description: 'کد اقتصادی (۱۰ تا ۱۴ رقم)' })
  @IsOptional()
  @IsString()
  @Matches(ECONOMIC_CODE)
  economicCode?: string;

  @ApiPropertyOptional({ description: 'تلفن', example: '02112345678' })
  @IsOptional()
  @IsString()
  @Matches(PHONE)
  phone?: string;

  @ApiPropertyOptional({ description: 'ایمیل' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ description: 'فعال (پیش‌فرض true)' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'سقف اعتبار (ریال)', example: '100000000' })
  @IsOptional()
  @IsString()
  @Matches(CREDIT_LIMIT, { message: 'سقف اعتبار باید یک مبلغ معتبر باشد.' })
  creditLimit?: string;

  @ApiPropertyOptional({ enum: CustomerGroup, description: 'گروه مشتری (پیش‌فرض مصرف‌کننده)', default: CustomerGroup.CONSUMER })
  @IsOptional()
  @IsEnum(CustomerGroup)
  customerGroup?: CustomerGroup;
}

/** `code` is the identity of the row and is never updatable. */
export class UpdatePartyDto {
  @ApiPropertyOptional({ description: 'نام طرف حساب' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: 'نام طرف حساب نباید خالی باشد.' })
  name?: string;

  @ApiPropertyOptional({ enum: PartyRole })
  @IsOptional()
  @IsEnum(PartyRole)
  role?: PartyRole;

  @ApiPropertyOptional({ description: 'شناسه ملی / کد ملی (۱۰ یا ۱۱ رقم)' })
  @IsOptional()
  @IsString()
  @Matches(NATIONAL_ID)
  nationalId?: string;

  @ApiPropertyOptional({ description: 'کد اقتصادی (۱۰ تا ۱۴ رقم)' })
  @IsOptional()
  @IsString()
  @Matches(ECONOMIC_CODE)
  economicCode?: string;

  @ApiPropertyOptional({ description: 'تلفن' })
  @IsOptional()
  @IsString()
  @Matches(PHONE)
  phone?: string;

  @ApiPropertyOptional({ description: 'ایمیل' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ description: 'فعال؛ غیرفعال کردن جای حذف را می‌گیرد' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'سقف اعتبار (ریال)' })
  @IsOptional()
  @IsString()
  @Matches(CREDIT_LIMIT, { message: 'سقف اعتبار باید یک مبلغ معتبر باشد.' })
  creditLimit?: string;

  @ApiPropertyOptional({ enum: CustomerGroup, description: 'گروه مشتری' })
  @IsOptional()
  @IsEnum(CustomerGroup)
  customerGroup?: CustomerGroup;
}

export class QueryPartiesDto {
  @ApiPropertyOptional({ enum: PartyRole, description: 'مشتری یا تامین‌کننده؛ «both» همیشه همراه نتیجه می‌آید' })
  @IsOptional()
  @IsEnum(PartyRole)
  role?: PartyRole;

  @ApiPropertyOptional({ description: 'فقط فعال‌ها (true/false)' })
  @IsOptional()
  @Transform(({ value }) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : value))
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'جست‌وجو در کد یا نام' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

// ---------------------------------------------------------------------- responses

export class PartyResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: PartyRole }) role: PartyRole;
  @ApiPropertyOptional({ nullable: true, type: String }) nationalId: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) economicCode: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) phone: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) email: string | null;
  @ApiProperty() active: boolean;
  @ApiPropertyOptional({ type: String, example: '100000000' }) creditLimit: string;
  @ApiProperty({ enum: CustomerGroup }) customerGroup: CustomerGroup;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class PartyListResponseDto {
  @ApiProperty({ type: [PartyResponseDto] }) data: PartyResponseDto[];
  @ApiProperty() total: number;
}
