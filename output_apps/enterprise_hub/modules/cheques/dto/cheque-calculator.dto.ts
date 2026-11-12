import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const normalizeAmountInput = ({ value }: { value: unknown }) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : value;
  }
  if (typeof value === 'string') {
    return value
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .trim()
      .replace(/[,٬_\s]/g, '');
  }
  return value;
};

const POSITIVE_AMOUNT_PATTERN = /^(?!0+(?:\.0+)?$)\d{1,16}(?:\.\d{1,2})?$/;

const normalizeOptionalTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class ChequeCalculationItemDto {
  @ApiPropertyOptional({ description: 'شناسه اختیاری چک در پایگاه داده یا شماره ردیف', example: 101 })
  @Transform(normalizeOptionalTrim)
  @IsOptional()
  @ValidateIf((_o, v) => v !== undefined && v !== null && typeof v !== 'number')
  @IsString({ message: 'شناسه چک باید عدد صحیح یا رشته باشد.' })
  @ValidateIf((_o, v) => v !== undefined && v !== null && typeof v !== 'string')
  @IsInt({ message: 'شناسه چک باید عدد صحیح یا رشته باشد.' })
  id?: string | number;

  @ApiProperty({ description: 'مبلغ چک (ریال، حداکثر ۲ رقم اعشار)', example: '50000000' })
  @Transform(normalizeAmountInput)
  @IsNotEmpty({ message: 'مبلغ چک الزامی است.' })
  @IsString({ message: 'مبلغ چک باید عدد یا رشته عددی معتبر باشد.' })
  @Matches(POSITIVE_AMOUNT_PATTERN, {
    message: 'مبلغ چک باید عددی مثبت با حداکثر ۱۶ رقم صحیح و ۲ رقم اعشار باشد.',
  })
  amount: string;

  @ApiProperty({ description: 'تاریخ سررسید چک (YYYY-MM-DD یا ISO)', example: '2026-12-01' })
  @IsNotEmpty({ message: 'تاریخ سررسید الزامی است.' })
  @IsString()
  @IsDateString({}, { message: 'فرمت تاریخ سررسید نامعتبر است.' })
  dueDate: string;

  @ApiPropertyOptional({ description: 'شماره ۱۶ رقمی صیاد', example: '1234567890123456' })
  @IsOptional()
  @IsString()
  sayadNumber?: string;

  @ApiPropertyOptional({ description: 'شرح یا بابت', example: 'تسویه فاکتور فروشگاه' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CalculateRasgiriDto {
  @ApiProperty({
    description: 'فهرست چک‌ها برای محاسبه راس‌گیری',
    type: [ChequeCalculationItemDto],
  })
  @IsArray({ message: 'فهرست چک‌ها باید آرایه باشد.' })
  @ArrayMinSize(1, { message: 'حداقل یک فقره چک برای محاسبه راس‌گیری الزامی است.' })
  @ArrayMaxSize(200, { message: 'حداکثر ۲۰۰ فقره چک در هر درخواست مجاز است.' })
  @ValidateNested({ each: true })
  @Type(() => ChequeCalculationItemDto)
  items: ChequeCalculationItemDto[];

  @ApiPropertyOptional({
    description: 'تاریخ مبنا (پیش‌فرض: امروز به وقت تهران YYYY-MM-DD)',
    example: '2026-11-11',
  })
  @Transform(normalizeOptionalTrim)
  @IsOptional()
  @IsDateString({}, { message: 'فرمت تاریخ مبنا نامعتبر است.' })
  baseDate?: string;
}

export class CalculateDiscountDto {
  @ApiProperty({
    description: 'فهرست چک‌ها برای محاسبه تنزیل',
    type: [ChequeCalculationItemDto],
  })
  @IsArray({ message: 'فهرست چک‌ها باید آرایه باشد.' })
  @ArrayMinSize(1, { message: 'حداقل یک فقره چک برای محاسبه تنزیل الزامی است.' })
  @ArrayMaxSize(200, { message: 'حداکثر ۲۰۰ فقره چک در هر درخواست مجاز است.' })
  @ValidateNested({ each: true })
  @Type(() => ChequeCalculationItemDto)
  items: ChequeCalculationItemDto[];

  @ApiProperty({
    description: 'نرخ تنزیل سالانه به درصد (۰ تا ۱۰۰)',
    example: 24,
  })
  @IsNumber({}, { message: 'نرخ تنزیل باید عدد باشد.' })
  @Min(0, { message: 'نرخ تنزیل نمی‌تواند منفی باشد.' })
  @Max(100, { message: 'نرخ تنزیل سالانه نمی‌تواند بیش از ۱۰۰ درصد باشد.' })
  annualRatePercent: number;

  @ApiPropertyOptional({
    description: 'تاریخ مبنا (پیش‌فرض: امروز به وقت تهران YYYY-MM-DD)',
    example: '2026-11-11',
  })
  @Transform(normalizeOptionalTrim)
  @IsOptional()
  @IsDateString({}, { message: 'فرمت تاریخ مبنا نامعتبر است.' })
  baseDate?: string;
}

export class CalculateSingleDiscountDto {
  @ApiProperty({ description: 'مبلغ چک (ریال، حداکثر ۲ رقم اعشار)', example: '100000000' })
  @Transform(normalizeAmountInput)
  @IsNotEmpty({ message: 'مبلغ چک الزامی است.' })
  @IsString({ message: 'مبلغ چک باید عدد یا رشته عددی معتبر باشد.' })
  @Matches(POSITIVE_AMOUNT_PATTERN, {
    message: 'مبلغ چک باید عددی مثبت با حداکثر ۱۶ رقم صحیح و ۲ رقم اعشار باشد.',
  })
  amount: string;

  @ApiProperty({ description: 'تعداد روز تا سررسید', example: 90 })
  @IsNumber({}, { message: 'تعداد روز باید عدد باشد.' })
  @Min(0, { message: 'تعداد روز نمی‌تواند منفی باشد.' })
  @Max(36500, { message: 'تعداد روز خارج از بازه مجاز است.' })
  days: number;

  @ApiProperty({ description: 'نرخ سالانه درصد (۰ تا ۱۰۰)', example: 24 })
  @IsNumber({}, { message: 'نرخ تنزیل باید عدد باشد.' })
  @Min(0, { message: 'نرخ تنزیل نمی‌تواند منفی باشد.' })
  @Max(100, { message: 'نرخ تنزیل سالانه نمی‌تواند بیش از ۱۰۰ درصد باشد.' })
  annualRatePercent: number;
}

export class CalculateSelectionRasgiriDto {
  @ApiProperty({ description: 'شناسه‌های چک‌های انتخاب‌شده', type: [Number], example: [1, 2] })
  @IsArray({ message: 'فهرست شناسه‌های چک باید آرایه باشد.' })
  @ArrayMinSize(1, { message: 'حداقل یک فقره چک باید انتخاب شود.' })
  @ArrayMaxSize(200, { message: 'حداکثر ۲۰۰ فقره چک قابل انتخاب هم‌زمان است.' })
  @ArrayUnique({ message: 'شناسه‌های چک نباید تکراری باشد.' })
  @IsInt({ each: true, message: 'شناسه چک باید عدد صحیح باشد.' })
  @Min(1, { each: true, message: 'شناسه چک نامعتبر است.' })
  chequeIds: number[];

  @ApiPropertyOptional({ description: 'تاریخ مبنا (YYYY-MM-DD)', example: '2026-11-11' })
  @Transform(normalizeOptionalTrim)
  @IsOptional()
  @IsDateString({}, { message: 'فرمت تاریخ مبنا نامعتبر است.' })
  baseDate?: string;
}

export class CalculateSelectionDiscountDto extends CalculateSelectionRasgiriDto {
  @ApiProperty({ description: 'نرخ تنزیل سالانه به درصد (۰ تا ۱۰۰)', example: 24 })
  @IsNumber({}, { message: 'نرخ تنزیل باید عدد باشد.' })
  @Min(0, { message: 'نرخ تنزیل نمی‌تواند منفی باشد.' })
  @Max(100, { message: 'نرخ تنزیل سالانه نمی‌تواند بیش از ۱۰۰ درصد باشد.' })
  annualRatePercent: number;
}
