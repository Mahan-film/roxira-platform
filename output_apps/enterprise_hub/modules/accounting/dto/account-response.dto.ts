import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../currency/enums/currency.enum';
import { AccountType } from '../enums/accounting.enum';

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
  balance: number;
}