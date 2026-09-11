import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../currency/enums/currency.enum';
import { AccountType } from '../enums/accounting.enum';

/**
 * یک سطر تراز آزمایشی (Trial Balance) به تفکیک حساب.
 */
export class TrialBalanceRowDto {
  @ApiProperty({ description: 'کد حساب' })
  code: string;

  @ApiProperty({ description: 'نام حساب' })
  name: string;

  @ApiProperty({ enum: AccountType, description: 'ماهیت حساب' })
  accountType: AccountType;

  @ApiProperty({ enum: Currency, description: 'ارز حساب', example: Currency.IRR })
  currency: Currency;

  @ApiProperty({ description: 'جمع بدهکار حساب (به ارز حساب)' })
  totalDebit: number;

  @ApiProperty({ description: 'جمع بستانکار حساب (به ارز حساب)' })
  totalCredit: number;

  @ApiProperty({ description: 'مانده حساب با علامت بدهکار-مثبت (به ارز حساب)' })
  balance: number;
}

/**
 * DTO خروجی ترازنامه/تراز آزمایشی دفتر کل.
 */
export class TrialBalanceResponseDto {
  @ApiProperty({ type: [TrialBalanceRowDto], description: 'سطرهای تراز به تفکیک حساب' })
  rows: TrialBalanceRowDto[];

  @ApiProperty({ description: 'جمع کل بدهکار (به تفکیک ارز هر حساب)' })
  totalDebit: number;

  @ApiProperty({ description: 'جمع کل بستانکار (به تفکیک ارز هر حساب)' })
  totalCredit: number;

  @ApiProperty({ description: 'آیا دفاتر تراز است؟' })
  balanced: boolean;

  @ApiProperty({ enum: Currency, description: 'ارز پایه تجمیع بین‌المللی' })
  baseCurrency: Currency;

  @ApiProperty({ description: 'جمع بدهکار معادل ارز پایه (تبدیل‌شده)' })
  baseTotalDebit: number;

  @ApiProperty({ description: 'جمع بستانکار معادل ارز پایه (تبدیل‌شده)' })
  baseTotalCredit: number;

  @ApiProperty({ description: 'آیا دفاتر پس از تبدیل به ارز پایه تراز است؟' })
  baseBalanced: boolean;
}