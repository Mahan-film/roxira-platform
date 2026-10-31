import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Money } from '../money';
import { PettyCashFundStatus, PettyCashKind, PettyCashStatus } from '../enums/accounting.enum';
import { IsMoneyAmount } from './money.validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreatePettyCashFundDto {
  @ApiProperty({ example: 'تنخواه کارگاه' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name: string;

  @ApiProperty({ example: 'علی رضایی' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  custodianName: string;

  @ApiPropertyOptional({ description: 'User id of the custodian, when they have an account' })
  @IsOptional()
  @IsUUID()
  custodianUserId?: string;

  @ApiProperty({ description: 'Ceiling of the fund', example: '50000000' })
  @IsMoneyAmount()
  imprestAmount: Money;

  @ApiPropertyOptional({ description: 'An existing asset account; by default a detail account is created under 1013' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  ledgerAccountCode?: string;
}

/** CHARGE and RETURN: posted to the ledger at once against a bank or cash account. */
export class PettyCashMovementDto {
  @ApiProperty()
  @IsMoneyAmount()
  amount: Money;

  @ApiProperty({ example: '2026-05-01' })
  @Matches(DATE_ONLY, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiProperty({ description: 'Bank or cash account', example: '1012' })
  @IsString()
  @MaxLength(32)
  accountCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CreatePettyCashExpenseDto {
  @ApiProperty()
  @IsMoneyAmount()
  amount: Money;

  @ApiProperty({ example: '2026-05-01' })
  @Matches(DATE_ONLY, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiProperty({ description: 'Expense account', example: '5030' })
  @IsString()
  @MaxLength(32)
  accountCode: string;

  @ApiProperty({ example: 'خرید لوازم التحریر' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  receiptNumber?: string;
}

export class SettlePettyCashDto {
  @ApiProperty({ type: [Number], description: 'Pending receipts to settle' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(400)
  @IsInt({ each: true })
  expenseIds: number[];

  @ApiProperty({ description: 'Date of the settlement entry', example: '2026-05-31' })
  @Matches(DATE_ONLY, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiPropertyOptional({ description: 'Bank or cash account: refill the fund by the settled total', example: '1012' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  replenishFromAccountCode?: string;
}

export class PettyCashFundResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() custodianName: string;
  @ApiProperty({ nullable: true }) custodianUserId: string | null;
  @ApiProperty() ledgerAccountCode: string;
  @ApiProperty() imprestAmount: Money;
  @ApiProperty({ enum: PettyCashFundStatus }) status: PettyCashFundStatus;
  @ApiProperty({ description: 'Ledger balance' }) balance: Money;
  @ApiProperty({ description: 'Receipts not settled yet' }) pending: Money;
  @ApiProperty({ description: 'Balance less pending receipts' }) available: Money;
}

export class PettyCashTransactionResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: PettyCashKind }) kind: PettyCashKind;
  @ApiProperty({ enum: PettyCashStatus }) status: PettyCashStatus;
  @ApiProperty() date: string;
  @ApiProperty() amount: Money;
  @ApiProperty() accountCode: string;
  @ApiProperty() description: string;
  @ApiProperty({ nullable: true }) receiptNumber: string | null;
  @ApiProperty({ nullable: true }) journalEntryId: number | null;
}

export class PettyCashStatementDto {
  @ApiProperty({ type: PettyCashFundResponseDto }) fund: PettyCashFundResponseDto;
  @ApiProperty({ type: [PettyCashTransactionResponseDto] }) transactions: PettyCashTransactionResponseDto[];
}
