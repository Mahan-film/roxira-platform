export const MONEY_TABS = [
  { key: "bank", label: "حساب‌های بانکی" },
  { key: "reconcile", label: "مغایرت‌گیری بانکی" },
  { key: "cash-boxes", label: "صندوق و کارتخوان" },
  { key: "petty-cash", label: "تنخواه‌گردان" },
  { key: "cheques", label: "چک‌ها" },
  { key: "damages", label: "خسارت تأخیر تأدیه" },
] as const;

export type MoneyTabKey = (typeof MONEY_TABS)[number]["key"];

export const DEFAULT_MONEY_TAB: MoneyTabKey = "bank";

const VALID_KEY_SET = new Set<string>(MONEY_TABS.map((t) => t.key));

export function isValidMoneyTab(key: unknown): key is MoneyTabKey {
  return typeof key === "string" && VALID_KEY_SET.has(key);
}

export function resolveMoneyTab(key: unknown): MoneyTabKey {
  return isValidMoneyTab(key) ? key : DEFAULT_MONEY_TAB;
}

export function getMoneyTabUrl(tab: MoneyTabKey): string {
  return tab === DEFAULT_MONEY_TAB ? "/app/money" : `/app/money?tab=${tab}`;
}
