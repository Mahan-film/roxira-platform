/**
 * قراردادهای تایپ‌سیف تطبیق کارپوشه مودیان؛ هم‌گام با
 * `modules/tax_compliance/dto/kartable-reconciliation.dto.ts`.
 */

export type KartableBucket =
  | "matched"
  | "amount_difference"
  | "missing_in_our_system"
  | "missing_in_kartable";

export type KartableMatchBy = "taxId" | "invoiceNumber" | "amount" | "none";

export type KartableSectionKind = "SALE" | "PURCHASE";

export interface KartableReconciliationRow {
  id: string;
  section: KartableSectionKind;
  bucket: KartableBucket;
  matchBy: KartableMatchBy;
  taxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  counterpartyName: string | null;
  ourInvoiceId: string | null;
  ourNetAmount: number | string | null;
  ourVatAmount: number | string | null;
  ourTotalAmount: number | string | null;
  kartableRowIndex: number | null;
  kartableNetAmount: number | string | null;
  kartableVatAmount: number | string | null;
  kartableTotalAmount: number | string | null;
  vatDiff: number | string | null;
  totalDiff: number | string | null;
  note: string | null;
}

export interface KartableSectionSummary {
  uploaded: boolean;
  fileName: string | null;
  formatId: string | null;
  kartableRowCount: number;
  outOfPeriodSkippedCount: number;
  undatedSkippedCount: number;
  ourInvoiceCount: number;
  matchedCount: number;
  amountDifferenceCount: number;
  missingInOurSystemCount: number;
  missingInKartableCount: number;
  ourTaxableBase: number | string;
  ourVatTotal: number | string;
  ourGrossTotal: number | string;
  kartableTaxableBase: number | string;
  kartableVatTotal: number | string;
  kartableGrossTotal: number | string;
}

export interface KartableQuarterlyVatTotals {
  our: {
    salesBase: number | string;
    salesVat: number | string;
    purchasesBase: number | string;
    purchasesVat: number | string;
    netVatPayable: number | string;
  };
  kartable: {
    salesBase: number | string;
    salesVat: number | string;
    purchasesBase: number | string;
    purchasesVat: number | string;
    netVatPayable: number | string;
  };
  diff: {
    salesVat: number | string;
    purchasesVat: number | string;
    netVatPayable: number | string;
  };
}

export interface KartableReconciliationResponse {
  period: {
    year: number;
    quarter: number;
    label: string;
    from: string;
    to: string;
  };
  currency: "IRR";
  sales: KartableSectionSummary;
  purchases: KartableSectionSummary;
  quarterlyVat: KartableQuarterlyVatTotals;
  rows: KartableReconciliationRow[];
}
