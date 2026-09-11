import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../currency/enums/currency.enum';
import { AccountResponseDto } from './account-response.dto';

/**
 * یک ردیف گردش حساب (Account Ledger Line) به همراه مانده تجمعی.
 */
export class AccountLedgerLineDto {
  @ApiProperty({ description: 'شناسه سطر سند' })
  id: number;

  @ApiProperty({ description: 'شناسه سند' })
  journalEntryId: number;

  @ApiProperty({ description: 'شماره سند' })
  entryNumber: string;

  @ApiProperty({ description: 'تاریخ سند' })
  date: Date;

  @ApiProperty({ description: 'شرح سند' })
  description: string;

  @ApiProperty({ description: 'مبلغ بدهکار (ریال)' })
  debit: number;

  @ApiProperty({ description: 'مبلغ بستانکار (ریال)' })
  credit: number;

  @ApiProperty({ description: 'مانده تجمعی تا این ردیف (بدهکار-مثبت)' })
  runningBalance: number;
}

/**
 * DTO خروجی گردش حساب (Account Ledger / Statement).
 */
export class AccountLedgerResponseDto {
  @ApiProperty({ type: AccountResponseDto, description: 'حساب مورد نظر' })
  account: AccountResponseDto;

  @ApiProperty({ description: 'مانده افتتاح بازه' })
  openingBalance: number;

  @ApiProperty({ description: 'جمع بدهکار بازه (ریال)' })
  totalDebit: number;

  @ApiProperty({ description: 'جمع بستانکار بازه (ریال)' })
  totalCredit: number;

  @ApiProperty({ description: 'مانده اختتام بازه' })
  closingBalance: number;

  @ApiProperty({ enum: Currency, description: 'ارز پایه تجمیع بین‌المللی' })
  baseCurrency: Currency;

  @ApiProperty({ description: 'مانده اختتام بازه معادل ارز پایه' })
  baseClosingBalance: number;

  @ApiProperty({ type: [AccountLedgerLineDto], description: 'ردیف‌های گردش حساب' })
  entries: AccountLedgerLineDto[];
}