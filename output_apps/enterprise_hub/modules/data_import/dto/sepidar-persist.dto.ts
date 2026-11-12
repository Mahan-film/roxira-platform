import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CustomerGroup } from '../../parties/enums/customer-group.enum';

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
  @IsBoolean()
  IsFloatingDetail?: boolean;
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
  @IsBoolean()
  IsCustomer: boolean;

  @ApiProperty()
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
  @Matches(/^\d+$/, { message: 'Debit must be a non-negative integer string' })
  Debit: string;

  @ApiProperty()
  @Transform(({ value }) =>
    value === null || value === undefined ? value : String(value).trim(),
  )
  @IsString()
  @Matches(/^\d+$/, { message: 'Credit must be a non-negative integer string' })
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

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  Amount: number;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'IssueDate must be YYYY-MM-DD' })
  IssueDate: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'DueDate must be YYYY-MM-DD' })
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
  @IsBoolean()
  useSynthetic?: boolean;

  @ApiPropertyOptional({ description: 'تاریخ سند افتتاحیه سپیدار (ISO YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  openingDate?: string;

  @ApiPropertyOptional({ description: 'گروه پیش‌فرض طرف‌حساب‌های واردشده', enum: CustomerGroup })
  @IsOptional()
  @IsEnum(CustomerGroup)
  customerGroup?: CustomerGroup;

  @ApiPropertyOptional({ description: 'فهرست خام حساب‌های سپیدار', type: [SepidarAccountDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SepidarAccountDto)
  accounts?: SepidarAccountDto[];

  @ApiPropertyOptional({ description: 'فهرست خام طرف‌حساب‌های سپیدار', type: [SepidarPartyDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SepidarPartyDto)
  parties?: SepidarPartyDto[];

  @ApiPropertyOptional({ description: 'فهرست خام کالاهای سپیدار', type: [SepidarItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SepidarItemDto)
  items?: SepidarItemDto[];

  @ApiPropertyOptional({ description: 'فهرست خام سطرهای سند افتتاحیه سپیدار', type: [SepidarVoucherItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SepidarVoucherItemDto)
  openingVoucher?: SepidarVoucherItemDto[];

  @ApiPropertyOptional({ description: 'فهرست خام چک‌های سپیدار', type: [SepidarChequeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SepidarChequeDto)
  cheques?: SepidarChequeDto[];
}
