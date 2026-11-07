import type { PolicyGroup } from "@/types/access";

/** Persian label of each policy group, shown as the card title. */
export function policyGroupLabel(group: PolicyGroup): string {
  if (group === "A") return "الف: ثابت (غیرقابل تغییر)";
  if (group === "B") return "ب: حفاظت از دفتر (دلیل طولانی‌تر)";
  return "ج: تصمیم مدیریت";
}

/** Minimum reason length for a group: A is never editable, B needs a longer justification. */
export function reasonMinLength(group: PolicyGroup): number {
  if (group === "A") return 0;
  if (group === "B") return 15;
  return 5;
}

/** Fixed (group A) keys are shown read-only. */
export function isEditable(group: PolicyGroup): boolean {
  return group !== "A";
}

const OPTION_LABELS: Record<string, string> = {
  always_differs: "تأییدکننده همیشه باید غیر از ثبت‌کننده باشد (پیش‌فرض)",
  differs_unless_sole_approver: "غیر از ثبت‌کننده؛ فقط اگر تأییدکنندهٔ دیگری نباشد خود ثبت‌کننده",
  creator_may_accept: "ثبت‌کننده هم می‌تواند تأیید کند (با ثبت در گزارش رخدادها)",
  refuse: "رد شود (پیش‌فرض)",
  allow: "مجاز باشد",
  draft_unless_auto_reverse: "پیش‌نویس، مگر برگشت‌خودکار (پیش‌فرض)",
  always_post: "همیشه قطعی شود",
};

/** Persian text of an enum option; falls back to the raw option. */
export function optionLabel(option: string): string {
  return OPTION_LABELS[option] ?? option;
}

const GROUP_LETTER: Record<PolicyGroup, string> = { A: "الف", B: "ب", C: "ج" };

/** Short Persian badge for the group letter. */
export function groupBadge(group: PolicyGroup): string {
  return GROUP_LETTER[group];
}
