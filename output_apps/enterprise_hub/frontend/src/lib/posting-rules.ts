export type PostingSource = "document" | "all" | "default";

export const SOURCE_LABELS: Record<PostingSource, string> = {
  document: "تنظیم همین سند",
  all: "تنظیم همه‌ی اسناد",
  default: "پیش‌فرض",
};

/** Accounts a role may point to: posting level (moein/tafsili) and an allowed account type. */
export function accountsForRole<T extends { level?: string | null; accountType: string }>(accounts: T[], types: string[]): T[] {
  return accounts.filter((a) => a.level !== "GROUP" && a.level !== "KOL" && types.includes(a.accountType));
}
