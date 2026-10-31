import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '../../currency/enums/currency.enum';
import { AccountLevel, AccountType, ReportLine } from '../enums/accounting.enum';
import { Money } from '../money';

/**
 * DTO خروجی حساب دفتر کل.
 */
export class AccountResponseDto {
  @ApiProperty({ description: 'شناسه یکتای حساب' })
  id: number;

  @ApiProperty({ description: 'کد حساب' })
  code: string;

  @ApiProperty({ description: 'نام حساب' })
  name: string;

  @ApiProperty({ enum: AccountType, description: 'ماهیت حساب' })
  accountType: AccountType;

  @ApiProperty({ enum: Currency, description: 'واحد پول' })
  currency: Currency;

  @ApiProperty({ description: 'مانده حساب با علامت بدهکار-مثبت' })
  balance: Money;

  @ApiPropertyOptional({ enum: AccountLevel, nullable: true, description: 'گروه، کل، معین یا تفصیلی' })
  level?: AccountLevel | null;

  @ApiPropertyOptional({ nullable: true, description: 'کد حساب بالادست' })
  parentCode?: string | null;

  @ApiPropertyOptional({ enum: ReportLine, nullable: true, description: 'ردیف صورت‌های مالی' })
  reportLine?: ReportLine | null;
}