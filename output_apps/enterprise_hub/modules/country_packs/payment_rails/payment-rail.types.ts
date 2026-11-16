import { PostingRole } from '../../posting_rules/constants/posting-roles';
import { ProposalLine, VoucherProposal } from '../../posting_rules/domain/posting-engine';
import { PaymentRailConfig } from '../country-pack.types';

export interface CreateRailSettlementDto {
  /** The rail id (e.g. 'card', 'duitnow', 'ewallet', 'shopee', 'tiktok', 'grabfood') or payment method */
  rail: string;
  /** ISO date string (YYYY-MM-DD or ISO timestamp) */
  date: string;
  /** Bank ledger account code where net proceeds were deposited (e.g. '11200' or '1012') */
  bankAccountCode: string;
  /** Gross settlement amount cleared from the payment rail clearing account (minor units) */
  grossAmount: bigint;
  /** Net proceeds deposited into bank account (minor units) */
  netAmount: bigint;
  /** Payment processing fee / Merchant Discount Rate (MDR) (minor units, default 0n) */
  feeAmount?: bigint;
  /** Marketplace / platform commission (minor units, default 0n) */
  commissionAmount?: bigint;
  /** Sales and Service Tax (SST) / VAT on fee and commission (minor units, default 0n) */
  sstAmount?: bigint;
  /** Payout reference / batch ID / transaction reference */
  reference?: string;
  /** Optional human-readable description */
  description?: string;
  /** Idempotency key to prevent duplicate settlement entries */
  idempotencyKey?: string;
  /** Role account overrides (e.g. custom fee or clearing account) */
  overrides?: Partial<Record<PostingRole, string>>;
}

export interface RailSettlementAmounts {
  gross: bigint;
  fee: bigint;
  commission: bigint;
  sst: bigint;
  net: bigint;
}

export interface RailSettlementPreview {
  rail: PaymentRailConfig;
  amounts: RailSettlementAmounts;
  proposal: VoucherProposal;
}
