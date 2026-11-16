import { formatMoneyRial } from "./fa-format.ts";

export interface HomeAlertItem {
  id: string;
  title: string;
  description: string;
  count: number;
  amountRial?: string | number;
  severity: "warning" | "destructive" | "info";
  href: string;
  iconName: string;
  actionLabel: string;
}

export interface HomeAlertMetrics {
  chequesDueCount?: number;
  chequesDueAmount?: string | number;
  unmatchedBankLinesCount?: number;
  pendingApprovalsCount?: number;
  importExceptionsCount?: number;
  lowStockCount?: number;
}

export interface HomeKpiData {
  cashNow: string | number;
  salesToday: string | number;
  profitThisMonth: string | number;
  overdueReceivables: string | number;
  isProfitConfidential?: boolean;
}

/**
 * Safely sums cash and bank amounts without precision loss on large Rial numbers (> 2^53).
 * Parses amounts directly as BigInt minor units without Number() or parseFloat().
 */
export function computeCashNow(
  cash: string | number | null | undefined,
  bank: string | number | null | undefined,
): string {
  const parseSafe = (v: string | number | null | undefined): bigint => {
    if (v === null || v === undefined) return 0n;
    const str = String(v).trim();
    if (!str) return 0n;
    const intPart = str.includes(".") ? str.split(".")[0] : str;
    try {
      return BigInt(intPart || "0");
    } catch {
      return 0n;
    }
  };
  return (parseSafe(cash) + parseSafe(bank)).toString();
}

/**
 * Determines whether profit / margin is visible to current user based on field visibility and role.
 */
export function isProfitVisibleForUser(
  hasMarginPermission: boolean,
  roleKey?: string | null,
): boolean {
  if (roleKey === "owner") return true;
  return hasMarginPermission;
}

/**
 * Formats a KPI amount in Iranian Rial with tabular numbers formatting.
 */
export function formatKpiDisplay(
  value: string | number | null | undefined,
  isConfidential = false,
): string {
  if (isConfidential) return "محرمانه";
  if (value === null || value === undefined) return "۰ ریال";
  return formatMoneyRial(value);
}

/**
 * Compiles operational alert items for the home feed based on active metrics.
 */
export function buildHomeAlerts(metrics: HomeAlertMetrics): HomeAlertItem[] {
  const items: HomeAlertItem[] = [];

  // 1. Cheques due in 7 days
  if (metrics.chequesDueCount && metrics.chequesDueCount > 0) {
    items.push({
      id: "cheques_due",
      title: "چک‌های سررسید ۷ روز آینده",
      description: `${metrics.chequesDueCount} فقره چک در ۷ روز آینده سررسید می‌شوند.`,
      count: metrics.chequesDueCount,
      amountRial: metrics.chequesDueAmount,
      severity: "warning",
      href: "/app/cheques",
      iconName: "CreditCard",
      actionLabel: "مشاهده اسناد",
    });
  }

  // 2. Unmatched bank lines
  if (metrics.unmatchedBankLinesCount && metrics.unmatchedBankLinesCount > 0) {
    items.push({
      id: "unmatched_bank",
      title: "تراکنش‌های تطبیق‌نشده بانکی",
      description: `${metrics.unmatchedBankLinesCount} گردش بانکی نیاز به تطبیق دارند.`,
      count: metrics.unmatchedBankLinesCount,
      severity: "info",
      href: "/app/accounting/bank/reconcile",
      iconName: "Landmark",
      actionLabel: "مغایرت‌گیری",
    });
  }

  // 3. Pending approvals
  if (metrics.pendingApprovalsCount && metrics.pendingApprovalsCount > 0) {
    items.push({
      id: "pending_approvals",
      title: "اسناد در انتظار تأیید",
      description: `${metrics.pendingApprovalsCount} سند یا پیش‌فاکتور منتظر بررسی نهایی است.`,
      count: metrics.pendingApprovalsCount,
      severity: "warning",
      href: "/app/accounting",
      iconName: "FileCheck2",
      actionLabel: "بررسی اسناد",
    });
  }

  // 4. Import exceptions
  if (metrics.importExceptionsCount && metrics.importExceptionsCount > 0) {
    items.push({
      id: "import_exceptions",
      title: "خطاهای بارگذاری و ایمپورت",
      description: `${metrics.importExceptionsCount} ردیف در بارگذاری اخیر با خطا مواجه شد.`,
      count: metrics.importExceptionsCount,
      severity: "destructive",
      href: "/app/import",
      iconName: "AlertTriangle",
      actionLabel: "مشاهده خطاها",
    });
  }

  // 5. Low stock items
  if (metrics.lowStockCount && metrics.lowStockCount > 0) {
    items.push({
      id: "low_stock",
      title: "کالاهای با کسری موجودی",
      description: `${metrics.lowStockCount} قلم کالا به کمتر از حداقل نقطه سفارش رسیده‌اند.`,
      count: metrics.lowStockCount,
      severity: "warning",
      href: "/app/inventory",
      iconName: "Boxes",
      actionLabel: "مشاهده انبار",
    });
  }

  return items;
}
