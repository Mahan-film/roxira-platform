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

/** Maximum rows allowed per entity array in one dry-run batch (payloads up to 10 MB accepted by NestJS body parser). */
export const MAX_DRY_RUN_ARRAY_ITEMS = 200;

const toTrimmedString = ({ value }: { value: unknown }): unknown =>
  value === null || value === undefined ? value : String(value).trim();

/** Prevents `enableImplicitConversion: true` from coercing string `"false"` into boolean `true`. */
const keepRawBoolean = ({ obj, key }: { obj?: Record<string, unknown>; key: string }): unknown =>
  obj ? obj[key] : undefined;

@ValidatorConstraint({ name: 'isoCalendarDate', async: false })
export class IsoCalendarDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const dt = new Date(Date.UTC(year, month - 1, day));
    return dt.getUTCFullYear() === year && dt.getUTCMonth() + 1 === month && dt.getUTCDate() === day;
  }

  defaultMessage(): string {
    return 'Date must be a valid YYYY-MM-DD calendar date';
  }
}

const DECIMAL_RIAL_PATTERN = /^\d+(\.\d{1,2})?$/;

export class SepidarDryRunAccountDto {
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
  ParentAccountID?: number | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(keepRawBoolean)
  @IsBoolean()
  IsFloatingDetail?: boolean;

  @ApiPropertyOptional({ enum: AccountType, description: 'نوع حساب در چارت مبدأ (در صورت نبود، بر اساس کد استاندارد استنتاج می‌شود)' })
  @IsOptional()
  @IsEnum(AccountType)
  AccountType?: AccountType;
}

export class SepidarDryRunPartyDto {
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

export class SepidarDryRunItemDto {
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
  @Transform(toTrimmedString)
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

export class SepidarDryRunVoucherItemDto {
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

  @ApiProperty({ description: 'Debit in Iranian Rials (string or non-negative decimal, max 2 decimals)' })
  @Transform(toTrimmedString)
  @IsString()
  @Matches(DECIMAL_RIAL_PATTERN, {
    message: 'Debit must be a non-negative Rial amount with at most 2 decimal places',
  })
  Debit: string;

  @ApiProperty({ description: 'Credit in Iranian Rials (string or non-negative decimal, max 2 decimals)' })
  @Transform(toTrimmedString)
  @IsString()
  @Matches(DECIMAL_RIAL_PATTERN, {
    message: 'Credit must be a non-negative Rial amount with at most 2 decimal places',
  })
  Credit: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  Description?: string | null;
}

export class DryRunChequeDto {
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

  @ApiProperty({ description: 'Cheque amount in Iranian Rials (positive decimal, max 2 decimals)' })
  @Transform(toTrimmedString)
  @IsString()
  @Matches(DECIMAL_RIAL_PATTERN, {
    message: 'Amount must be a non-negative Rial amount with at most 2 decimal places',
  })
  Amount: string;

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

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  SpentToPartyCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  SpentToPartyName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  SpentToNationalId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  ReceiverNationalId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  Description?: string | null;
}

export class SepidarDryRunDto {
  @ApiPropertyOptional({
    description: 'اجرای آزمایشی با داده‌های ساختگی (فقط در محیط غیرتولیدی و با ارسال صریح true)',
    default: false,
  })
  @IsOptional()
  @Transform(keepRawBoolean)
  @IsBoolean()
  useSynthetic?: boolean;

  @ApiPropertyOptional({ description: 'تاریخ سند افتتاحیه (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'openingDate must be YYYY-MM-DD' })
  @Validate(IsoCalendarDateConstraint)
  openingDate?: string;

  @ApiPropertyOptional({ enum: CustomerGroup })
  @IsOptional()
  @IsEnum(CustomerGroup)
  customerGroup?: CustomerGroup;

  @ApiPropertyOptional({ type: [SepidarDryRunAccountDto], maxItems: MAX_DRY_RUN_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRY_RUN_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SepidarDryRunAccountDto)
  accounts?: SepidarDryRunAccountDto[];

  @ApiPropertyOptional({ type: [SepidarDryRunPartyDto], maxItems: MAX_DRY_RUN_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRY_RUN_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SepidarDryRunPartyDto)
  parties?: SepidarDryRunPartyDto[];

  @ApiPropertyOptional({ type: [SepidarDryRunItemDto], maxItems: MAX_DRY_RUN_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRY_RUN_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SepidarDryRunItemDto)
  items?: SepidarDryRunItemDto[];

  @ApiPropertyOptional({ type: [SepidarDryRunVoucherItemDto], maxItems: MAX_DRY_RUN_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRY_RUN_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SepidarDryRunVoucherItemDto)
  openingVoucher?: SepidarDryRunVoucherItemDto[];

  @ApiPropertyOptional({ type: [DryRunChequeDto], maxItems: MAX_DRY_RUN_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRY_RUN_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => DryRunChequeDto)
  cheques?: DryRunChequeDto[];
}

export class HolooDryRunAccountDto {
  @ApiProperty()
  @IsInt()
  AccountId: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  Code: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  Name: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(4)
  Level: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  ParentCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(keepRawBoolean)
  @IsBoolean()
  IsFloatingDetail?: boolean;

  @ApiPropertyOptional({ enum: AccountType, description: 'نوع حساب در چارت مبدأ (در صورت نبود، بر اساس کد استاندارد استنتاج می‌شود)' })
  @IsOptional()
  @IsEnum(AccountType)
  AccountType?: AccountType;
}

export class HolooDryRunPartyDto {
  @ApiProperty()
  @IsInt()
  PartyId: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  Code: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  Name: string;

  @ApiProperty()
  @Transform(keepRawBoolean)
  @IsBoolean()
  IsCustomer: boolean;

  @ApiProperty()
  @Transform(keepRawBoolean)
  @IsBoolean()
  IsSupplier: boolean;

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

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  Mobile?: string | null;
}

export class HolooDryRunItemDto {
  @ApiProperty()
  @IsInt()
  ItemId: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  Code: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  Name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  Barcode?: string | null;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  Unit: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  SecondaryUnit?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(toTrimmedString)
  @Matches(/^\d+(\.\d{1,4})?$/, {
    message: 'UnitRatio must be a non-negative decimal with at most 4 decimal places',
  })
  UnitRatio?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  Category?: string | null;
}

export class HolooDryRunVoucherItemDto {
  @ApiProperty()
  @IsInt()
  SanadId: number;

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

  @ApiProperty({ description: 'Debit in Iranian Rials (string or non-negative decimal, max 2 decimals)' })
  @Transform(toTrimmedString)
  @IsString()
  @Matches(DECIMAL_RIAL_PATTERN, {
    message: 'Debit must be a non-negative Rial amount with at most 2 decimal places',
  })
  Debit: string;

  @ApiProperty({ description: 'Credit in Iranian Rials (string or non-negative decimal, max 2 decimals)' })
  @Transform(toTrimmedString)
  @IsString()
  @Matches(DECIMAL_RIAL_PATTERN, {
    message: 'Credit must be a non-negative Rial amount with at most 2 decimal places',
  })
  Credit: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  Description?: string | null;
}

export class HolooDryRunDto {
  @ApiPropertyOptional({
    description: 'اجرای آزمایشی با داده‌های ساختگی (فقط در محیط غیرتولیدی و با ارسال صریح true)',
    default: false,
  })
  @IsOptional()
  @Transform(keepRawBoolean)
  @IsBoolean()
  useSynthetic?: boolean;

  @ApiPropertyOptional({ description: 'تاریخ سند افتتاحیه (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'openingDate must be YYYY-MM-DD' })
  @Validate(IsoCalendarDateConstraint)
  openingDate?: string;

  @ApiPropertyOptional({ enum: CustomerGroup })
  @IsOptional()
  @IsEnum(CustomerGroup)
  customerGroup?: CustomerGroup;

  @ApiPropertyOptional({ type: [HolooDryRunAccountDto], maxItems: MAX_DRY_RUN_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRY_RUN_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => HolooDryRunAccountDto)
  accounts?: HolooDryRunAccountDto[];

  @ApiPropertyOptional({ type: [HolooDryRunPartyDto], maxItems: MAX_DRY_RUN_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRY_RUN_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => HolooDryRunPartyDto)
  parties?: HolooDryRunPartyDto[];

  @ApiPropertyOptional({ type: [HolooDryRunItemDto], maxItems: MAX_DRY_RUN_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRY_RUN_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => HolooDryRunItemDto)
  items?: HolooDryRunItemDto[];

  @ApiPropertyOptional({ type: [HolooDryRunVoucherItemDto], maxItems: MAX_DRY_RUN_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRY_RUN_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => HolooDryRunVoucherItemDto)
  openingVoucher?: HolooDryRunVoucherItemDto[];

  @ApiPropertyOptional({ type: [DryRunChequeDto], maxItems: MAX_DRY_RUN_ARRAY_ITEMS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRY_RUN_ARRAY_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => DryRunChequeDto)
  cheques?: DryRunChequeDto[];
}
