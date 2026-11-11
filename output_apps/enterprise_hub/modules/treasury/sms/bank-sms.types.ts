import { BankCode } from '../../banking/enums/banking.enum';
import { TreasuryDocKind } from '../enums/treasury.enum';

export type BankSmsDirection = 'deposit' | 'withdraw';

export interface BankSmsParsedResult {
  bank: BankCode;
  bankNameFa: string;
  direction: BankSmsDirection;
  docKind: TreasuryDocKind;
  /** Amount in integer minor units (BigInt) */
  amountMinor: bigint;
  /** Exact decimal string format ("2500000.00") */
  amountDecimal: string;
  /** Balance in integer minor units if available */
  balanceMinor?: bigint;
  balanceDecimal?: string;
  /** Formatted ISO date-time string */
  dateTime?: string;
  /** Tail 4 (or more) digits of card */
  cardTail?: string;
  /** Tail digits of bank account */
  accountTail?: string;
  /** Reference or tracking number if present */
  reference?: string;
  /** Raw input text */
  rawText: string;
}
