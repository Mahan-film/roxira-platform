import { ApiProperty } from '@nestjs/swagger';
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

  @ApiProperty({ description: 'واحد پول' })
  currency: string;

  @ApiProperty({ description: 'مانده حساب با علامت بدهکار-مثبت' })
  balance: number;
}