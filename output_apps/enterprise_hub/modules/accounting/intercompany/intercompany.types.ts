/**
 * T182: Intercompany and Multi-Entity Consolidation Types.
 * Strictly uses BigInt minor units for all monetary amounts and scaled integer rates.
 */

export const SCALE_1M = 1_000_000n;

export type AccountCategory =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'REVENUE'
  | 'EXPENSE';

export interface IntercompanyJournalLine {
  accountCode: string;
  accountName?: string;
  category: AccountCategory;
  debitMinor: bigint;
  creditMinor: bigint;
  description?: string;
}

export interface IntercompanyJournalEntry {
  entityId: string;
  entryNumber: string;
  date: string;
  description: string;
  lines: IntercompanyJournalLine[];
  counterpartyEntityId?: string;
  counterpartyDocNumber?: string;
  pairId?: string;
}

export interface IntercompanyInvoiceInput {
  invoiceNumber: string;
  date: string;
  sellerEntityId: string; // e.g. Parent P
  buyerEntityId: string;  // e.g. Subsidiary S
  currency: string;
  amountMinor: bigint;
  description: string;
  receivableAccountCode?: string; // default: '1150'
  revenueAccountCode?: string;    // default: '4100'
  payableAccountCode?: string;    // default: '2150'
  expenseAccountCode?: string;    // default: '6100'
}

export interface IntercompanyPairResult {
  pairId: string;
  sellerInvoiceEntry: IntercompanyJournalEntry;
  buyerMirrorBillEntry: IntercompanyJournalEntry;
}

export interface EntityBalance {
  accountCode: string;
  accountName: string;
  category: AccountCategory;
  debitMinor: bigint;
  creditMinor: bigint;
}

export interface EntityFinancialProfile {
  entityId: string;
  entityName: string;
  currency: string;
  balances: EntityBalance[];
}

export interface SubsidiaryOwnershipConfig {
  subsidiaryEntityId: string;
  ownershipRatioScaled6: bigint; // e.g. 800_000n = 80.0000%
  acquisitionEquityMinor: bigint;
  investmentAccountCode?: string;        // default: '1500'
  subsidiaryEquityAccountCode?: string;  // default: '3000'
  nciEquityAccountCode?: string;         // default: '3500'
  intercompanyReceivableCode?: string;   // default: '1150'
  intercompanyPayableCode?: string;      // default: '2150'
  intercompanyRevenueCode?: string;      // default: '4100'
  intercompanyExpenseCode?: string;      // default: '6100'
}

export interface ConsolidationGroupConfig {
  groupId: string;
  groupName: string;
  reportingCurrency: string;
  parentEntityId: string;
  subsidiaries: SubsidiaryOwnershipConfig[];
}

export interface EliminationEntry {
  type: 'INTERCOMPANY_PL' | 'INTERCOMPANY_BS' | 'INVESTMENT_EQUITY';
  description: string;
  lines: IntercompanyJournalLine[];
}

export interface ConsolidatedBalanceSheet {
  totalAssetsMinor: bigint;
  totalLiabilitiesMinor: bigint;
  controllingEquityMinor: bigint;
  nciEquityMinor: bigint;
  totalEquityMinor: bigint;
  isBalanced: boolean;
}

export interface ConsolidatedIncomeStatement {
  externalRevenueMinor: bigint;
  externalExpenseMinor: bigint;
  consolidatedNetIncomeBeforeNciMinor: bigint;
  nciShareMinor: bigint;
  controllingNetIncomeMinor: bigint;
}

export interface ConsolidationResult {
  groupId: string;
  eliminations: EliminationEntry[];
  incomeStatement: ConsolidatedIncomeStatement;
  balanceSheet: ConsolidatedBalanceSheet;
  consolidatedBalances: EntityBalance[];
}
