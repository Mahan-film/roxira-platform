import { isoToJalaliParts, jalaliMonthLength, jalaliToIso } from "./jalali.ts";
import type { OnboardingState, OnboardingStepKey, OnboardingStepStatus } from "../types/onboarding.ts";

/** Where the Moadian step sends the user. Only the tax page exists; the setup wizard of T95 may add a deeper route. */
export const MOADIAN_SETUP_HREF = "/app/tax";

/** Opening balances go through the existing import flow («ورود از اکسل»). */
export const OPENING_BALANCES_HREF = "/app/import";

export const ONBOARDING_HREF = "/app/onboarding";

export interface OnboardingStepInfo {
  key: OnboardingStepKey;
  title: string;
  description: string;
}

/** The six steps in wizard order. Keys match `OnboardingStep` on the server. */
export const ONBOARDING_STEPS: readonly OnboardingStepInfo[] = [
  { key: "profile", title: "مشخصات شرکت", description: "نام شرکت، شماره اقتصادی و شناسه ملی" },
  { key: "fiscal_year", title: "سال مالی", description: "تعریف سال مالی جاری" },
  { key: "chart", title: "سرفصل حساب‌ها", description: "افزودن سرفصل استاندارد از قالب" },
  { key: "opening_balances", title: "مانده‌های اول دوره", description: "ورود مانده‌های اول دوره از فایل" },
  { key: "users", title: "دعوت همکاران", description: "دعوت کاربران با نقش مناسب" },
  { key: "moadian", title: "سامانه مودیان", description: "اتصال به سامانه مودیان مالیاتی" },
];

export const STEP_STATUS_LABELS: Record<OnboardingStepStatus, string> = {
  pending: "انجام نشده",
  done: "انجام شد",
  skipped: "رد شد",
};

export interface OnboardingCounts {
  total: number;
  done: number;
  skipped: number;
  pending: number;
  /** done + skipped: the steps that no longer wait for the user. */
  finished: number;
}

export function onboardingCounts(state: Pick<OnboardingState, "steps">): OnboardingCounts {
  const statuses = ONBOARDING_STEPS.map((step) => state.steps[step.key] ?? "pending");
  const done = statuses.filter((s) => s === "done").length;
  const skipped = statuses.filter((s) => s === "skipped").length;
  return {
    total: statuses.length,
    done,
    skipped,
    pending: statuses.length - done - skipped,
    finished: done + skipped,
  };
}

/** The first step still waiting, or null when none is. */
export function firstPendingStep(state: Pick<OnboardingState, "steps">): OnboardingStepKey | null {
  return ONBOARDING_STEPS.find((step) => (state.steps[step.key] ?? "pending") === "pending")?.key ?? null;
}

/** The dashboard banner: only to people who can act on it, until the work is done or dismissed. */
export function shouldShowBanner(state: Pick<OnboardingState, "completed" | "dismissed">, isAdmin: boolean): boolean {
  return isAdmin && !state.completed && !state.dismissed;
}

/**
 * The one-time redirect of a brand-new organisation to the wizard. Only an administrator of an
 * organisation that has the accounting module and no accounts yet is sent; everyone else is
 * marked as handled by the caller so the redirect never fires later.
 */
export function shouldRedirectToWizard(
  state: Pick<OnboardingState, "completed" | "firstVisit">,
  context: { isAdmin: boolean; hasAccounting: boolean; accountCount: number },
): boolean {
  return state.firstVisit && !state.completed && context.isAdmin && context.hasAccounting && context.accountCount === 0;
}

/** Persian and Arabic-Indic digits to Latin; spaces and dashes removed. */
export function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[\s-]/g, "");
}

/** Economic code: 11 to 14 digits (the same rule as the server). */
export function isValidEconomicCode(value: string): boolean {
  return /^\d{11,14}$/.test(toLatinDigits(value));
}

/** National id: 10 digits (person) or 11 digits (legal entity). */
export function isValidNationalId(value: string): boolean {
  return /^\d{10,11}$/.test(toLatinDigits(value));
}

export interface ProfileFormValue {
  name: string;
  economicCode: string;
  nationalId: string;
}

/** Field errors for the profile form (empty object = valid). The two identifiers are optional. */
export function profileErrors(value: ProfileFormValue): Partial<Record<keyof ProfileFormValue, string>> {
  const errors: Partial<Record<keyof ProfileFormValue, string>> = {};
  if (value.name.trim().length < 2) errors.name = "نام شرکت دست‌کم دو حرف باشد.";
  if (value.economicCode.trim() !== "" && !isValidEconomicCode(value.economicCode)) {
    errors.economicCode = "شماره اقتصادی باید ۱۱ تا ۱۴ رقم باشد.";
  }
  if (value.nationalId.trim() !== "" && !isValidNationalId(value.nationalId)) {
    errors.nationalId = "شناسه ملی باید ۱۰ یا ۱۱ رقم باشد.";
  }
  return errors;
}

/** Request body of the profile step: empty identifiers are left out and digits are Latin. */
export function profilePayload(value: ProfileFormValue) {
  const economicCode = toLatinDigits(value.economicCode);
  const nationalId = toLatinDigits(value.nationalId);
  return {
    name: value.name.trim(),
    ...(economicCode ? { economicCode } : {}),
    ...(nationalId ? { nationalId } : {}),
  };
}

/** The Iranian fiscal year (1 Farvardin to the last day of Esfand) that contains `todayIso`; dates are Gregorian ISO. */
export function defaultFiscalYear(todayIso: string): { name: string; startDate: string; endDate: string } | null {
  const today = isoToJalaliParts(todayIso);
  if (!today) return null;
  const startDate = jalaliToIso(`${today.jy}/01/01`);
  const endDate = jalaliToIso(`${today.jy}/12/${String(jalaliMonthLength(today.jy, 12)).padStart(2, "0")}`);
  if (!startDate || !endDate) return null;
  return { name: String(today.jy), startDate, endDate };
}
