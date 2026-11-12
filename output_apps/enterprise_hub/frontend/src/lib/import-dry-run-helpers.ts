/**
 * Shared types and pure formatting/validation helpers for the T100
 * Sepidar / Holoo transactional import dry-run report.
 */

export type ImportDryRunSource = "sepidar" | "holoo";

export interface ImportDryRunEntityCount {
  incoming: number;
  wouldInsert: number;
  existingSkipped: number;
  invalidCount: number;
}

export type ImportDryRunUnmappedReason =
  | "missing_in_chart"
  | "non_postable_level"
  | "floating_detail_only"
  | "has_child_accounts";

export interface ImportDryRunUnmappedAccount {
  accountCode: string;
  reason: ImportDryRunUnmappedReason;
  lineCount: number;
  debitMinor: string;
  creditMinor: string;
  debitRial: string;
  creditRial: string;
  sampleLineIds: number[];
}

export type ImportDryRunDuplicateReason =
  | "duplicate_code_in_batch"
  | "duplicate_national_id_in_batch"
  | "existing_code_in_db"
  | "existing_national_id_in_db";

export interface ImportDryRunDuplicateParty {
  code: string;
  name: string;
  nationalId: string | null;
  reason: ImportDryRunDuplicateReason;
  conflictingCode: string | null;
}

export interface ImportDryRunTrialBalanceLine {
  accountCode: string;
  accountName: string | null;
  mapped: boolean;
  debitMinor: string;
  creditMinor: string;
  debitRial: string;
  creditRial: string;
  netMinor: string;
}

export interface ImportDryRunReport {
  source: ImportDryRunSource;
  dryRun: true;
  rolledBack: true;
  tenantId: string;
  generatedAt: string;
  readyToCommit: boolean;
  blockersFa: string[];
  warningsFa: string[];
  counts: {
    accounts: ImportDryRunEntityCount;
    parties: ImportDryRunEntityCount & { duplicates: number };
    items: ImportDryRunEntityCount;
    openingLines: ImportDryRunEntityCount & { unmapped: number };
    cheques: ImportDryRunEntityCount & { openValid: number; closedSkipped: number };
  };
  openingTrialBalance: {
    balanced: boolean;
    totalDebitMinor: string;
    totalCreditMinor: string;
    varianceMinor: string;
    totalDebitRial: string;
    totalCreditRial: string;
    varianceRial: string;
    lineCount: number;
    persistedInTx: boolean;
    accounts: ImportDryRunTrialBalanceLine[];
  };
  unmappedAccounts: ImportDryRunUnmappedAccount[];
  duplicateParties: ImportDryRunDuplicateParty[];
  openCheques: {
    totalCount: number;
    totalAmountMinor: string;
    totalAmountRial: string;
    receivedCount: number;
    receivedAmountMinor: string;
    receivedAmountRial: string;
    issuedCount: number;
    issuedAmountMinor: string;
    issuedAmountRial: string;
    endorsedCount: number;
    endorsedAmountMinor: string;
    endorsedAmountRial: string;
    wouldInsertCount: number;
    existingSkippedCount: number;
    invalidErrors: Array<{ chequeNumber: string; reason: string }>;
  };
  txVerification: {
    dbAccountsAfterInsert: number;
    dbPartiesAfterInsert: number;
    dbItemsAfterInsert: number;
    dbOpeningLinesAfterInsert: number;
    dbChequesAfterInsert: number;
  };
}

export type DryRunJsonParseResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; errorFa: string };

const DRY_RUN_COLLECTION_KEYS = [
  "accounts",
  "parties",
  "items",
  "openingVoucher",
  "cheques",
] as const;

export function parseDryRunJsonPayload(rawText: string): DryRunJsonParseResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: false, errorFa: "متن JSON ورودی خالی است." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, errorFa: "ساختار JSON معتبر نیست؛ لطفاً نحو فایل را بررسی کنید." };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, errorFa: "ورودی JSON باید یک آبجکت شامل جداول حساب، اشخاص، کالا یا چک باشد." };
  }

  const record = parsed as Record<string, unknown>;
  for (const key of DRY_RUN_COLLECTION_KEYS) {
    const val = record[key];
    if (val !== undefined && !Array.isArray(val)) {
      return { ok: false, errorFa: `فیلد «${key}» در JSON باید آرایه باشد.` };
    }
  }

  const hasSynthetic = record.useSynthetic === true;
  const hasAnyRows = DRY_RUN_COLLECTION_KEYS.some(
    (key) => Array.isArray(record[key]) && (record[key] as unknown[]).length > 0,
  );

  if (!hasSynthetic && !hasAnyRows) {
    return {
      ok: false,
      errorFa: "حداقل یکی از آرایه‌های حساب‌ها، اشخاص، کالاها، سند افتتاحیه یا چک‌ها باید دارای ردیف باشد.",
    };
  }

  return { ok: true, payload: record };
}

const UNMAPPED_REASON_LABELS: Record<ImportDryRunUnmappedReason, string> = {
  missing_in_chart: "حساب در کدینگ یافت نشد",
  non_postable_level: "سطح غیرقابل ثبت (کل یا گروه)",
  floating_detail_only: "حساب تفصیلی شناور است (معین نیست)",
  has_child_accounts: "حساب دارای زیرمجموعه است",
};

export function unmappedReasonLabel(reason: ImportDryRunUnmappedReason): string {
  return UNMAPPED_REASON_LABELS[reason];
}

const DUPLICATE_REASON_LABELS: Record<ImportDryRunDuplicateReason, string> = {
  duplicate_code_in_batch: "کد شخص در فایل ورودی تکراری است",
  duplicate_national_id_in_batch: "کد ملی در فایل ورودی تکراری است",
  existing_code_in_db: "کد شخص از قبل در سامانه ثبت شده است",
  existing_national_id_in_db: "کد ملی از قبل در سامانه ثبت شده است",
};

export function duplicateReasonLabel(reason: ImportDryRunDuplicateReason): string {
  return DUPLICATE_REASON_LABELS[reason];
}

export function sourceDisplayLabel(source: ImportDryRunSource): string {
  return source === "sepidar" ? "سپیدار همکاران سیستم" : "هلو (طرفه‌نگار)";
}

export interface DryRunSummaryGate {
  canProceedToCommit: boolean;
  headlineFa: string;
  blockerCount: number;
  warningCount: number;
}

export function summarizeDryRunGate(report: ImportDryRunReport): DryRunSummaryGate {
  const blockerCount = report.blockersFa.length;
  const warningCount = report.warningsFa.length;
  const canProceedToCommit = report.rolledBack && report.readyToCommit && blockerCount === 0;
  return {
    canProceedToCommit,
    headlineFa: canProceedToCommit
      ? "گزارش آزمایشی بدون خطای مسدودکننده بازگردانی شد و آمادهٔ ثبت نهایی است."
      : `پیش‌نمایش با ${blockerCount} خطای مسدودکننده و ${warningCount} هشدار بازگردانی شد؛ پیش از ثبت نهایی موارد زیر را اصلاح کنید.`,
    blockerCount,
    warningCount,
  };
}
