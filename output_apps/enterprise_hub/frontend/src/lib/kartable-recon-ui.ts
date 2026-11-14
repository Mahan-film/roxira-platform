import type {
  KartableBucket,
  KartableMatchBy,
  KartableReconciliationRow,
  KartableSectionKind,
} from "../types/kartable-reconciliation";

export const QUARTER_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "فصل ۱ (بهار — فروردین تا خرداد)" },
  { value: 2, label: "فصل ۲ (تابستان — تیر تا شهریور)" },
  { value: 3, label: "فصل ۳ (پاییز — مهر تا آبان/آذر)" },
  { value: 4, label: "فصل ۴ (زمستان — دی تا اسفند)" },
];

export const BUCKET_LABELS: Record<KartableBucket, string> = {
  matched: "تطبیق کامل",
  amount_difference: "اختلاف مبلغ",
  missing_in_our_system: "در کارپوشه هست، در سیستم ما نیست",
  missing_in_kartable: "در سیستم ما هست، در کارپوشه نیست",
};

export const SECTION_LABELS: Record<KartableSectionKind, string> = {
  SALE: "فروش",
  PURCHASE: "خرید",
};

export const MATCH_BY_LABELS: Record<KartableMatchBy, string> = {
  taxId: "شماره مالیاتی",
  invoiceNumber: "شماره صورتحساب",
  amount: "مبلغ یکتا",
  none: "—",
};

export type ReconBucketFilter = "all" | KartableBucket;
export type ReconSectionFilter = "all" | KartableSectionKind;

export function filterReconRows(
  rows: KartableReconciliationRow[],
  bucketFilter: ReconBucketFilter,
  sectionFilter: ReconSectionFilter,
  query: string,
): KartableReconciliationRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (bucketFilter !== "all" && row.bucket !== bucketFilter) return false;
    if (sectionFilter !== "all" && row.section !== sectionFilter) return false;
    if (!q) return true;
    const haystack = [
      row.taxId ?? "",
      row.invoiceNumber ?? "",
      row.counterpartyName ?? "",
      row.note ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function isNonZeroAmount(value: number | string | null | undefined): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number") return value !== 0;
  return !/^-?0+(?:\.0+)?$/.test(value.trim());
}
