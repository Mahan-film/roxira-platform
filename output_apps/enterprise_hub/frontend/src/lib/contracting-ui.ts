import type { ContractSide, ContractStatus, StatementStatus, TermUse } from "@/types/contracting";

export const SIDE_LABEL: Record<ContractSide, string> = {
  employer: "ما کارفرما هستیم (پرداخت به پیمانکار)",
  contractor: "ما پیمانکار هستیم (صورت‌حساب به کارفرما)",
};
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = { draft: "پیش‌نویس", active: "فعال", closed: "بسته" };
export const STATEMENT_STATUS_LABEL: Record<StatementStatus, string> = { draft: "پیش‌نویس", approved: "تأییدشده", posted: "ثبت‌شده" };

/**
 * How a statutory figure is presented. Only a verified platform figure is "legal fact"; an organisation's
 * own figure is shown as the organisation's, and an unverified platform figure says so.
 */
export function termProvenance(term: TermUse): string {
  if (term.tenantOverride) return "مقدار ثبت‌شده سازمان (تأیید قانونی نشده)";
  return term.verified ? "مقدار قانونی تأییدشده" : "مقدار ثانویه، هنوز تأیید نشده";
}

/** A rate such as "0.1" as Persian-friendly percent text "10٪"; exact decimal shifting, no float math. */
export function rateAsPercent(rate: string): string {
  const [int, frac = ""] = rate.split(".");
  const padded = (frac + "00").slice(0, Math.max(2, frac.length));
  const whole = `${int}${padded.slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  const rest = padded.slice(2).replace(/0+$/, "");
  return `${rest ? `${whole}.${rest}` : whole}٪`;
}

export function nextAction(status: StatementStatus): "approve" | "post" | null {
  return status === "draft" ? "approve" : status === "approved" ? "post" : null;
}
