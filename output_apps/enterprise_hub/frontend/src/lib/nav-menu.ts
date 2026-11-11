import type { AccessActionKey, AccessModuleKey } from "../types/access";

export interface MenuLeaf {
  href: string;
  label: string;
  icon: string;
  module?: AccessModuleKey;
  keywords?: string[];
}

export interface MenuGroup {
  id: string;
  label: string;
  icon: string;
  items: MenuLeaf[];
}

export const MENU_GROUPS: MenuGroup[] = [
  {
    id: "dashboard",
    label: "پیشخوان",
    icon: "LayoutDashboard",
    items: [
      { href: "/app", label: "داشبورد", icon: "LayoutDashboard" },
      {
        href: "/app/assistant",
        label: "دستیار هوشمند",
        icon: "MessageSquareText",
        module: "assistant",
        keywords: ["ai", "دستیار"],
      },
    ],
  },
  {
    id: "parties",
    label: "طرف‌حساب‌ها و کالاها",
    icon: "Contact",
    items: [
      {
        href: "/app/crm",
        label: "مشتریان و طرف‌حساب‌ها",
        icon: "Contact",
        module: "crm",
        keywords: ["customer", "lead", "مشتری", "سرنخ"],
      },
      {
        href: "/app/import",
        label: "ورود از اکسل",
        icon: "FileUp",
        module: "data_import",
        keywords: ["excel", "csv", "اکسل"],
      },
    ],
  },
  {
    id: "sales",
    label: "فروش و پایانه فروشگاهی",
    icon: "ShoppingCart",
    items: [
      {
        href: "/app/invoicing",
        label: "صورتحساب‌ها",
        icon: "ReceiptText",
        module: "invoicing",
        keywords: ["invoice", "فاکتور"],
      },
    ],
  },
  {
    id: "purchase",
    label: "خرید و هزینه‌ها",
    icon: "Wallet",
    items: [],
  },
  {
    id: "stock",
    label: "انبارداری",
    icon: "Boxes",
    items: [
      {
        href: "/app/inventory",
        label: "کالا و موجودی",
        icon: "Warehouse",
        module: "inventory",
        keywords: ["stock", "warehouse", "کالا", "انبار", "موجودی"],
      },
      {
        href: "/app/inventory/production",
        label: "فرمول ساخت و تولید (BOM)",
        icon: "Factory",
        module: "inventory",
        keywords: ["bom", "production", "تولید", "فرمول ساخت", "ضایعات"],
      },
      {
        href: "/damages",
        label: "خسارت‌ها",
        icon: "ShieldAlert",
        module: "damages",
      },
    ],
  },
  {
    id: "treasury",
    label: "خزانه‌داری",
    icon: "Landmark",
    items: [
      {
        href: "/app/accounting/bank",
        label: "حساب‌های بانکی",
        icon: "Building2",
        module: "banking",
      },
      { href: "/app/cheques", label: "چک‌ها", icon: "Banknote", module: "cheques" },
      {
        href: "/app/treasury/petty-cash",
        label: "صندوق و تنخواه",
        icon: "Wallet",
        module: "accounting",
      },
    ],
  },
  {
    id: "accounting",
    label: "حسابداری و اموال",
    icon: "BookOpenCheck",
    items: [
      {
        href: "/app/accounting/vouchers",
        label: "اسناد حسابداری",
        icon: "ReceiptText",
        module: "accounting",
        keywords: ["voucher", "journal", "سند", "دفتر روزنامه"],
      },
      {
        href: "/app/accounting/chart",
        label: "درخت حساب‌ها",
        icon: "BookOpenCheck",
        module: "accounting",
        keywords: ["chart", "ledger", "tree", "سرفصل", "کدینگ", "تراز"],
      },
      {
        href: "/app/accounting/dashboard",
        label: "داشبورد مدیریتی",
        icon: "ChartColumn",
        module: "accounting",
      },
      {
        href: "/app/accounting/fiscal-years",
        label: "سال مالی و سرفصل",
        icon: "CalendarRange",
        module: "accounting",
      },
      {
        href: "/app/accounting/recurring-vouchers",
        label: "اسناد دوره‌ای",
        icon: "ReceiptText",
        module: "accounting",
      },
      {
        href: "/app/accounting/fixed-assets",
        label: "دارایی‌های ثابت",
        icon: "Building2",
        module: "accounting",
      },
      {
        href: "/app/contracting",
        label: "قراردادها و پروژه‌ها",
        icon: "ClipboardList",
        module: "accounting",
      },
    ],
  },
  {
    id: "payroll",
    label: "حقوق و دستمزد",
    icon: "UsersRound",
    items: [
      { href: "/app/hr", label: "کارکنان", icon: "UsersRound", module: "hr", keywords: ["employee", "کارمند", "پرسنل"] },
      {
        href: "/app/hr/attendance",
        label: "کارکرد، مرخصی و وام",
        icon: "CalendarCheck",
        module: "hr",
        keywords: ["attendance", "leave", "loan", "کارکرد", "مرخصی", "وام", "مساعده"],
      },
      {
        href: "/app/hr/payroll",
        label: "حقوق ماهانه",
        icon: "Calculator",
        module: "hr",
      },
      {
        href: "/app/hr/statutory",
        label: "بیمه و مالیات حقوق",
        icon: "ClipboardList",
        module: "hr",
      },
    ],
  },
  {
    id: "tax",
    label: "مالیات",
    icon: "Landmark",
    items: [
      { href: "/app/tax", label: "مالیات و مودیان", icon: "Landmark", module: "tax" },
    ],
  },
  {
    id: "reports-settings",
    label: "گزارش‌ها و تنظیمات",
    icon: "Settings",
    items: [
      {
        href: "/app/reports",
        label: "گزارش‌ها",
        icon: "ChartColumn",
        module: "accounting",
      },
      {
        href: "/app/accounting/report-builder",
        label: "گزارش‌ساز",
        icon: "ChartColumn",
        module: "accounting",
        keywords: ["report builder", "custom report", "گزارش سفارشی", "تلفیقی"],
      },
      {
        href: "/app/settings/members",
        label: "اعضا و نقش‌ها",
        icon: "Settings",
        module: "members",
      },
      {
        href: "/app/settings/modules",
        label: "ماژول‌ها",
        icon: "Puzzle",
        module: "members",
      },
      {
        href: "/app/settings/posting-rules",
        label: "ثبت خودکار سند",
        icon: "Workflow",
        module: "accounting",
      },
      {
        href: "/app/settings/policies",
        label: "قواعد سازمان",
        icon: "Settings",
        module: "members",
      },
      {
        href: "/app/settings/audit",
        label: "گزارش رخدادها",
        icon: "ClipboardList",
        module: "audit",
      },
      {
        href: "/app/settings/security",
        label: "امنیت حساب",
        icon: "ShieldCheck",
      },
    ],
  },
];

export const OPERATOR_ITEMS: MenuLeaf[] = [
  { href: "/app/admin/entitlements", label: "ماژول‌های مشتریان", icon: "KeyRound" },
];

export interface QuickCreate {
  id: string;
  label: string;
  href: string;
  module: AccessModuleKey;
  action: AccessActionKey;
  keywords: string[];
  icon: string;
}

export const QUICK_CREATE: QuickCreate[] = [
  {
    id: "new-lead",
    label: "سرنخ جدید",
    href: "/app/crm?new=1",
    module: "crm",
    action: "create",
    keywords: ["مشتری جدید", "سرنخ", "new customer", "crm", "lead"],
    icon: "UserPlus",
  },
  {
    id: "new-invoice",
    label: "صورتحساب جدید",
    href: "/app/invoicing?new=1",
    module: "invoicing",
    action: "create",
    keywords: ["فاکتور جدید", "صدور", "new bill", "invoice"],
    icon: "Plus",
  },
  {
    id: "new-employee",
    label: "کارمند جدید",
    href: "/app/hr?new=1",
    module: "hr",
    action: "create",
    keywords: ["پرسنل جدید", "استخدام", "new staff", "hr", "employee"],
    icon: "UserPlus",
  },
  {
    id: "import-file",
    label: "ورود فایل",
    href: "/app/import",
    module: "data_import",
    action: "create",
    keywords: ["اکسل", "csv", "pdf", "عکس", "excel", "upload", "file"],
    icon: "FileUp",
  },
];

export function visibleGroups(
  can: (m: AccessModuleKey, a: AccessActionKey) => boolean,
  opts: { assistantEnabled: boolean },
): MenuGroup[] {
  const isVisible = (item: MenuLeaf): boolean => {
    if (item.href === "/app/assistant" && !opts.assistantEnabled) return false;
    if (item.href === "/app") return true;
    if (!item.module) return true;
    return can(item.module, "read");
  };
  return MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(isVisible),
  })).filter((group) => group.items.length > 0);
}

export function activeHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const matches =
      href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(href + "/");
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
