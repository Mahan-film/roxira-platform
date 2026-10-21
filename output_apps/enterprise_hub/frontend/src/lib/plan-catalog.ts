/**
 * Copy and feature lines for the 4 Smart Judge plan cards (free / basic / pro / premium / team).
 *
 * No price lives here: Toman amounts always come from the backend pricing matrix.
 * Daily limits and draft types come from `limits` (the same constants the server enforces).
 */
import type {
  BackendPlanPrice,
  BillingPeriod,
  PaidLevel,
  SubscriptionPlanKey,
} from "@/components/judge/subscription/types";
import type { PlanLimits } from "@/lib/plans-data";

export type PlanLevel = "free" | PaidLevel;

export const PAID_LEVELS: PaidLevel[] = ["basic", "pro", "premium", "team"];

/** Levels that get the «بررسی قرارداد» (contract review) mode; the server enforces it too. */
export const CONTRACT_REVIEW_LEVELS: readonly PlanLevel[] = ["premium", "team"];

export function canReviewContract(level: PlanLevel | undefined): boolean {
  return level !== undefined && CONTRACT_REVIEW_LEVELS.includes(level);
}
export const PLAN_LEVELS: PlanLevel[] = ["free", ...PAID_LEVELS];
export const RECOMMENDED_LEVEL: PaidLevel = "pro";

export const DRAFT_LABELS: Record<string, string> = {
  defense: "لایحه دفاعیه",
  petition: "دادخواست",
  complaint: "شکواییه",
  notice: "اظهارنامه",
  ruling: "پیش‌نویس رأی",
  indictment: "کیفرخواست",
};

export interface LevelCopy {
  title: string;
  tagline: string;
  /** Model quality in plain Persian. */
  model: string;
}

export const LEVEL_COPY: Record<PlanLevel, LevelCopy> = {
  free: { title: "رایگان", tagline: "برای شروع و پرسش‌های ساده", model: "مدل‌های رایگان" },
  basic: { title: "پایه", tagline: "پاسخ سریع‌تر برای استفادهٔ روزمره", model: "مدل سریع پولی" },
  pro: { title: "حرفه‌ای", tagline: "برای وکلا و پرونده‌های جدی", model: "مدل‌های قوی" },
  premium: { title: "ویژه", tagline: "بالاترین کیفیت برای پرونده‌های سنگین", model: "بهترین مدل‌های دنیا" },
  team: {
    title: "تیمی و سازمانی",
    tagline: "وکلا و تیم‌های حقوقی",
    model: "بهترین مدل‌های دنیا با بیشترین سهمیه",
  },
};

export function planKey(level: PaidLevel, period: BillingPeriod): SubscriptionPlanKey {
  return `SJ_${level.toUpperCase()}_${period === "yearly" ? "YEARLY" : "MONTHLY"}` as SubscriptionPlanKey;
}

export function periodLabel(period: BillingPeriod): string {
  return period === "yearly" ? "در سال" : "در ماه";
}

/** Monthly equivalent of a yearly price, for display only (never sent to the server). */
export function monthlyEquivalent(plan: BackendPlanPrice): number {
  return Math.round(plan.price_toman / 12);
}

export function draftsText(list: string[] | undefined): string {
  return list && list.length ? list.map((t) => DRAFT_LABELS[t] ?? t).join("، ") : "—";
}

type Fa = (n: number) => string;

/** Plain-language feature lines for a level, built only from server-provided numbers. */
export function featureLines(level: PlanLevel, limits: PlanLimits, fa: Fa): string[] {
  const day = limits.chat_messages_per_day;
  const lines: string[] = [LEVEL_COPY[level].model];

  if (level === "free") {
    if (day) {
      lines.push(`مهمان: تا ${fa(day.guest ?? 0)} پرسش در روز`);
      lines.push(`کاربر واردشده: تا ${fa(day.free ?? 0)} پرسش در روز`);
    }
  } else if (day?.[level] != null) {
    lines.push(`تا ${fa(day[level] as number)} پرسش در روز`);
  }

  const top = limits.top_model_answers_per_day;
  if (level === "pro" && top?.pro != null) {
    lines.push(`${fa(top.pro)} پاسخ در روز با مدل‌های قوی، سپس مدل سریع پولی`);
  }
  if (level === "premium" && top?.premium != null) {
    lines.push(`${fa(top.premium)} پاسخ در روز با بهترین مدل‌های دنیا، سپس مدل‌های قوی`);
  }

  if (level === "team" && top?.team != null) {
    lines.push(`${fa(top.team)} پاسخ در روز با بهترین مدل‌های دنیا، سپس مدل‌های قوی`);
  }
  if (canReviewContract(level)) {
    lines.push("بررسی قرارداد: ریسک، بندهای ناعادلانه، استناد قانونی و متن پیشنهادی اصلاح");
  }

  const drafts = limits.draft_types[level === "free" ? "free" : level];
  lines.push(`پیش‌نویس: ${draftsText(drafts ?? limits.draft_types.free)}`);

  const files = limits.file_uploads_per_day[level === "free" ? "free" : level];
  if (files != null) lines.push(`بارگذاری تا ${fa(files)} فایل پرونده در روز`);
  return lines;
}
