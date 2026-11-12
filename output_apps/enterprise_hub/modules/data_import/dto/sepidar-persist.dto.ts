import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { AccountType } from '../../accounting/enums/accounting.enum';
import { CustomerGroup } from '../../parties/enums/customer-group.enum';

export const MAX_SEPIDAR_ARRAY_ITEMS = 200;

/** Preserves raw JSON boolean so enableImplicitConversion does not turn "false" into true. */
const keepRawBoolean = ({
  obj,
  key,
}: {
  obj?: Record<string, unknown>;
  key: string;
}): unknown => (obj ? obj[key] : undefined);

@ValidatorConstraint({ name: 'sepidarIsoCalendarDate', async: false })
class IsoCalendarDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const [y, m, d] = value.split('-').map((part) => Number(part));
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }

  defaultMessage(): string {
    return 'Date must be a valid Gregorian calendar date in YYYY-MM-DD format';
  }
}

@ValidatorConstraint({ name: 'sepidarAccountTypeMap', async: false })
class AccountTypeMapConstraint implements ValidatorConstraintInterface {
  private readonly validValues = new Set<string>(Object.values(AccountType));

  validate(value: unknown): boolean {
    if (value === undefined) return true;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value as Record<string, unknown>).every(
      (v) => typeof v === 'string' && this.validValues.has(v),
    );
  }

  defaultMessage(): string {
    return 'accountTypeMap must map account codes to valid AccountType enum values';
  }
}

export class SepidarAccountDto {
  @ApiProperty()
  @IsInt()
  AccountID: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  Code: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  Title: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(4)
  Level: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  ParentAccountID: number | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(keepRawBoolean)
  @IsBoolean()
  IsFloatingDetail?: boolean;

  @ApiPropertyOptional({
    enum: AccountType,
    description: 'نوع صریح حساب؛ در صورت نبود از گروه حساب استاندارد ایران استنتاج می‌شود',
  })
  @IsOptional()
  @IsEnum(AccountType)
  AccountType?: AccountType;
}

export class SepidarPartyDto {
  @ApiProperty()
  @IsInt()
  PartyID: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  Code: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  Title: string;

  @ApiProperty()
  @Transform(keepRawBoolean)
  @IsBoolean()
  IsCustomer: boolean;

  @ApiProperty()
  @Transform(keepRawBoolean)
  @IsBoolean()
  IsVendor: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  NationalCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  EconomicCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  Phone?: string | null;
}

export class SepidarItemDto {
  @ApiProperty()
  @IsInt()
  ItemID: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  Code: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  Title: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  Barcode?: string | null;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  UnitTitle: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  SecondaryUnitTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined ? value : String(value).trim(),
  )
  @Matches(/^\d+(\.\d{1,4})?$/, {
    message: 'UnitConversionRate must be a non-negative decimal with at most 4 decimal places',
  })
  UnitConversionRate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  CategoryTitle?: string | null;
}

export class SepidarVoucherItemDto {
  @ApiProperty()
  @IsInt()
  VoucherItemID: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  AccountCode: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  FloatingDetailCode?: string | null;

  @ApiProperty()
  @Transform(({ value }) =>
    value === null || value === undefined ? value : String(value).trim(),
  )
  @IsString()
  @MaxLength(16)
  @Matches(/^\d+$/, { message: 'Debit must be a non-negative integer Rial string' })
  Debit: string;

  @ApiProperty()
  @Transform(({ value }) =>
    value === null || value === undefined ? value : String(value).trim(),
  )
  @IsString()
  @MaxLength(16)
  @Matches(/^\d+$/, { message: 'Credit must be a non-negative integer Rial string' })
  Credit: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  Description?: string | null;
}

export class SepidarChequeDto {
  @ApiProperty()
  @IsInt()
  ChequeId: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  ChequeNumber: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  SayadNumber: string;

  @ApiProperty()
  @IsIn(['received', 'issued'])
  Direction: 'received' | 'issued';

  @ApiProperty()
  @IsIn(['in_hand', 'deposited', 'spent', 'delivered', 'cleared', 'bounced', 'returned'])
  State: 'in_hand' | 'deposited' | 'spent' | 'delivered' | 'cleared' | 'bounced' | 'returned';

  @ApiProperty({ description: 'Whole IRR integer amount (max 15 digits to fit numeric(18,2) after x100 minor conversion)' })
  @IsInt()
  @IsPositive()
  @Max(999_999_999_999_999)
  Amount: number;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'IssueDate must be YYYY-MM-DD' })
  @Validate(IsoCalendarDateConstraint)
  IssueDate: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'DueDate must be YYYY-MM-DD' })
  @Validate(IsoCalendarDateConstraint)
  DueDate: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  PartyCode: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  PartyName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  BankName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  BranchName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  BankAccountNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  SpentToPartyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  SpentToPartyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  SpentToNationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  ReceiverNationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  Description?: string;
}

export class PersistSepidarDto {
  @ApiPropertyOptional({
    description: 'اجرای آزمایشی با داده‌های ساختگی (فقط در محیط غیرتولیدی و با ارسال صریح true)',
    default: false,
  })
  @IsOptional()
  @Transform(keepRawBoolean)
  @IsBoolean()
  useSynthetic?: boolean;

  @ApiPropertyOptional({ description: 'تاریخ سند افتتاحیه سپیدار (ISO YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'openingDate must be YYYY-MM-DD' })
  @Validate(IsoCalendarDateConstraint)
  openingDate?: string;

  @ApiPropertyOptional({ description: 'گروه پیش‌فرض طرف‌حساب‌های واردشده', enum: CustomerGroup })
  @IsOptional()
  @IsEnum(CustomerGroup)
  customerGroup?: CustomerGroup;

  @ApiPropertyOptional({
    description: 'نگاشت صریح کد حساب به نوع حساب (برای کدهای غیراستاندارد یا بازنویسی پیش‌فرض)',
  })
  @IsOptional()
  @Validate(AccountTypeMapConstraint)
  accountTypeMap?: Record<string, AccountType>;

  @ApiPropertyOptional({ description: 'فهرست خام حساب‌های سپیدار', type: [SepidarAccountDto], maxItems: MAX_SEPIDAR_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SEPIDAR_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SepidarAccountDto)
  accounts?: SepidarAccountDto[];

  @ApiPropertyOptional({ description: 'فهرست خام طرف‌حساب‌های سپیدار', type: [SepidarPartyDto], maxItems: MAX_SEPIDAR_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SEPIDAR_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SepidarPartyDto)
  parties?: SepidarPartyDto[];

  @ApiPropertyOptional({ description: 'فهرست خام کالاهای سپیدار', type: [SepidarItemDto], maxItems: MAX_SEPIDAR_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SEPIDAR_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SepidarItemDto)
  items?: SepidarItemDto[];

  @ApiPropertyOptional({ description: 'فهرست خام سطرهای سند افتتاحیه سپیدار', type: [SepidarVoucherItemDto], maxItems: MAX_SEPIDAR_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SEPIDAR_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SepidarVoucherItemDto)
  openingVoucher?: SepidarVoucherItemDto[];

  @ApiPropertyOptional({ description: 'فهرست خام چک‌های سپیدار', type: [SepidarChequeDto], maxItems: MAX_SEPIDAR_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SEPIDAR_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SepidarChequeDto)
  cheques?: SepidarChequeDto[];
}
