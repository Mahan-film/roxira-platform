import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Currency } from '../../currency/enums/currency.enum';
import { AccountLevel, AccountType, ReportLine } from '../enums/accounting.enum';

/**
 * DTO ایجاد حساب جدید در دفتر کل (Chart of Accounts).
 * تمام فیلدها با class-validator اعتبارسنجی می‌شوند (Rule #2 AGENTS.md).
 */
export class CreateAccountDto {
  @ApiProperty({ description: 'کد یکتای حساب', example: '1010' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code: string;

  @ApiProperty({ description: 'نام حساب', example: 'موجودی نقد و بانک' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name: string;

  @ApiProperty({ description: 'ماهیت حساب', enum: AccountType })
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiPropertyOptional({
    description:
      'واحد پول حساب (پیش‌فرض IRR)؛ ارزهای بین‌المللی USD/EUR/AED پشتیبانی می‌شوند.',
    enum: Currency,
    default: Currency.IRR,
  })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({ enum: AccountLevel, description: 'سطح حساب: معین یا تفصیلی' })
  @IsOptional()
  @IsEnum(AccountLevel)
  level?: AccountLevel;

  @ApiPropertyOptional({ description: 'کد حساب بالادست', example: '1012' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  parentCode?: string;

  @ApiPropertyOptional({ enum: ReportLine, description: 'ردیف صورت‌های مالی' })
  @IsOptional()
  @IsEnum(ReportLine)
  reportLine?: ReportLine;
}