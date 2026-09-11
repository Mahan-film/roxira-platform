import { ApiProperty } from '@nestjs/swagger';
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

  @ApiProperty({ description: 'جمع بدهکار حساب (ریال)' })
  totalDebit: number;

  @ApiProperty({ description: 'جمع بستانکار حساب (ریال)' })
  totalCredit: number;

  @ApiProperty({ description: 'مانده حساب با علامت بدهکار-مثبت' })
  balance: number;
}

/**
 * DTO خروجی ترازنامه/تراز آزمایشی دفتر کل.
 */
export class TrialBalanceResponseDto {
  @ApiProperty({ type: [TrialBalanceRowDto], description: 'سطرهای تراز به تفکیک حساب' })
  rows: TrialBalanceRowDto[];

  @ApiProperty({ description: 'جمع کل بدهکار (ریال)' })
  totalDebit: number;

  @ApiProperty({ description: 'جمع کل بستانکار (ریال)' })
  totalCredit: number;

  @ApiProperty({ description: 'آیا دفاتر تراز است؟' })
  balanced: boolean;
}