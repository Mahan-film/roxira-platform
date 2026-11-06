import { formatJalaliDate, formatMoneyRial } from "@/lib/fa-format";

/** The two facts the seasonal API really gives: period end date and payable amount. */
export interface NextDeadlineInput {
  periodTo?: string | null;
  payable?: number | string | null;
  loading?: boolean;
}

export interface NextDeadlineView {
  state: "loading" | "empty" | "ready";
  dateLabel: string | null;
  amountLabel: string | null;
  note: string;
}

export const DEADLINE_NOTE =
  "مهلت قانونی این اظهارنامه در سامانه ثبت نشده است.";

function amountLabelOf(payable: number | string | null): string | null {
  if (payable === null) return null;
  if (typeof payable === "number") return formatMoneyRial(payable);
  const n = Number(payable);
  return Number.isSafeInteger(n) ? formatMoneyRial(n) : payable;
}

export function nextDeadlineView(input: NextDeadlineInput): NextDeadlineView {
  if (input.loading) {
    return { state: "loading", dateLabel: null, amountLabel: null, note: DEADLINE_NOTE };
  }
  if (!input.periodTo) {
    return { state: "empty", dateLabel: null, amountLabel: null, note: DEADLINE_NOTE };
  }
  return {
    state: "ready",
    dateLabel: formatJalaliDate(input.periodTo),
    amountLabel: amountLabelOf(input.payable ?? null),
    note: DEADLINE_NOTE,
  };
}
