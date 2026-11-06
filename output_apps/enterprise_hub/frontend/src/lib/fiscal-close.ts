export type ChecklistStatus = "ok" | "blocked" | "unknown";

export interface ChecklistItem {
  key: "drafts" | "bank" | "depreciation";
  label: string;
  status: ChecklistStatus;
  detail: string;
}

export interface CloseChecklistInput {
  draftCount: number | null;
  bankDifferences: Array<{ accountName: string; difference: number | null }> | null;
}

export type PeriodLockLike = { periodStart: string; periodEnd: string; active: boolean };

export function toPersianDigits(n: number): string {
  const latin = Math.abs(n).toString();
  const persian = latin.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  return n < 0 ? `-${persian}` : persian;
}

export function normalizeName(s: string): string {
  return s
    .trim()
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[\u200C\s]/g, "");
}

export function buildCloseChecklist(input: CloseChecklistInput): ChecklistItem[] {
  const drafts: ChecklistItem =
    input.draftCount === null
      ? {
          key: "drafts",
          label: "سندهای پیش‌نویس",
          status: "unknown",
          detail: "تعداد سندهای پیش‌نویس در دسترس نیست",
        }
      : input.draftCount === 0
        ? {
            key: "drafts",
            label: "سندهای پیش‌نویس",
            status: "ok",
            detail: "سند پیش‌نویسی در این سال نیست",
          }
        : {
            key: "drafts",
            label: "سندهای پیش‌نویس",
            status: "blocked",
            detail: `${toPersianDigits(input.draftCount)} سند پیش‌نویس باید قطعی یا حذف شود`,
          };

  let bank: ChecklistItem;
  if (input.bankDifferences === null) {
    bank = {
      key: "bank",
      label: "مغایرت‌گیری بانک",
      status: "unknown",
      detail: "وضعیت حساب‌های بانکی در دسترس نیست",
    };
  } else if (input.bankDifferences.length === 0) {
    bank = {
      key: "bank",
      label: "مغایرت‌گیری بانک",
      status: "ok",
      detail: "حساب بانکی تعریف نشده است",
    };
  } else {
    const missing = input.bankDifferences.find((entry) => entry.difference === null);
    if (missing) {
      bank = {
        key: "bank",
        label: "مغایرت‌گیری بانک",
        status: "unknown",
        detail: `مانده مغایرت‌گیری حساب ${missing.accountName} در دسترس نیست`,
      };
    } else {
      const unsettled = input.bankDifferences.find((entry) => entry.difference !== 0);
      if (unsettled) {
        bank = {
          key: "bank",
          label: "مغایرت‌گیری بانک",
          status: "blocked",
          detail: `حساب ${unsettled.accountName} هنوز تطبیق نشده است`,
        };
      } else {
        bank = {
          key: "bank",
          label: "مغایرت‌گیری بانک",
          status: "ok",
          detail: "همه حساب‌های بانکی تطبیق شده‌اند",
        };
      }
    }
  }

  const depreciation: ChecklistItem = {
    key: "depreciation",
    label: "استهلاک دارایی‌های ثابت",
    status: "unknown",
    detail: "آخرین ماه ثبت‌شده هنوز از سرور در دسترس نیست؛ پیش از بستن دستی بررسی کنید",
  };

  return [drafts, bank, depreciation];
}

export function canConfirmClose(items: ChecklistItem[], typedName: string, yearName: string): boolean {
  if (items.some((item) => item.status === "blocked")) return false;
  const normalizedYear = normalizeName(yearName);
  if (normalizedYear === "") return false;
  return normalizeName(typedName) === normalizedYear;
}

export function periodLockState(
  locks: PeriodLockLike[],
  startDate: string,
  endDate: string,
): "locked" | "open" {
  return locks.some(
    (lock) => lock.active && lock.periodStart <= endDate && lock.periodEnd >= startDate,
  )
    ? "locked"
    : "open";
}
