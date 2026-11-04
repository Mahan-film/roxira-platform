/** JSON written by `services/migration_worker/certificate.mjs`. Amounts are integer rials as strings. */
export interface CertificateControl {
  accounts: string[];
  ledgerBalance: string;
  difference: string;
}

export interface MigrationCertificate {
  version: 1;
  tenantId: string;
  source: string | null;
  generatedAt: string;
  currency: 'IRR';
  contentSha256: string;
  status: 'clean' | 'differences-routed-to-suspense' | 'blocked';
  blocking: Array<{ code: 'no-source-tb' | 'lines-unbalanced' | 'unknown-accounts' | 'control-differs' | 'stock-differs'; message: string; count?: number; control?: string; difference?: string }>;
  approval: { required: true; status: 'pending' };
  trialBalance: {
    sourceTrialBalanceProvided: boolean;
    accountsCompared: number;
    accountsWithDifference: number;
    migratedTotals: { debit: string; credit: string; balanced: boolean };
    differences: Array<{
      account: string;
      source: string;
      migrated: string;
      difference: string;
      suspectDocuments: Array<{ sourceTable: string; voucher: string; firstRow: number; voucherDifference: string }>;
    }>;
    suspense: { code: string; nameFa: string; amount: string; note: string };
    unbalancedVoucherCount: number;
    unknownAccounts: Array<{ account: string; net: string }>;
  };
  subledgers: {
    openItems: null | {
      ar: { total: string; items: number; parties: number; kindInferred: number };
      ap: { total: string; items: number; parties: number; kindInferred: number };
      controlAr: CertificateControl | null;
      controlAp: CertificateControl | null;
    };
    cheques: null | {
      receivable: { total: string; count: number };
      payable: { total: string; count: number };
      controlReceivable: CertificateControl | null;
      controlPayable: CertificateControl | null;
    };
  };
  stock: null | {
    itemWarehousePairs: number;
    sourceBalancesProvided: boolean;
    valuation: 'FIFO';
    differenceCount: number;
    differences: Array<{ item: string; warehouse: string; qtyComputed: string; qtySource: string; valueComputed: string; valueSource: string | null; qtyDifference: string; valueDifference: string | null }>;
    negativeCount: number;
    negativeStock: Array<{ item: string; warehouse: string; endingQty: string; lowestRunningQty: string | null; proposedAdjustmentQty: string; atUnitCost: string | null; note: string }>;
  };
  rejectedRows: Array<{ target: string; sourceTables: string[]; rows: number; firstRow: number }>;
}
