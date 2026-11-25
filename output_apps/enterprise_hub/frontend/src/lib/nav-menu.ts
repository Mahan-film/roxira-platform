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

/**
 * Seven-hub architecture (WAVE 14 / R1 Product UX Reset):
 * 1. خانه (Home)
 * 2. فروش (Sales)
 * 3. خرید و انبار (Purchases & Stock)
 * 4. پول (Money - /app/money)
 * 5. کارکنان (People)
 * 6. حسابداری و مالیات (Accounting & Tax)
 * 7. گزارش‌ها (Reports)
 *
 * Footer: تنظیمات (Settings - /app/settings)
 */
export const MENU_GROUPS: MenuGroup[] = [
  {
    id: "home",
    label: "خانه",
    icon: "Home",
    items: [
      { href: "/app", label: "پیشخوان", icon: "LayoutDashboard" },
      {
        href: "/app/onboarding",
        label: "راه‌اندازی شرکت",
        icon: "ClipboardList",
        module: "members",
        keywords: ["onboarding", "setup", "wizard", "شروع", "راه‌اندازی", "سال مالی", "سرفصل"],
      },
      {
        href: "/app/assistant",
        label: "دستیار هوشمند",
        icon: "MessageSquareText",
        module: "assistant",
        keywords: ["ai", "دستیار", "chat", "هوش مصنوعی"],
      },
    ],
  },
  {
    id: "sales",
    label: "فروش",
    icon: "ShoppingCart",
    items: [
      {
        href: "/app/sales",
        label: "چرخه فروش و سفارشات",
        icon: "ClipboardList",
        module: "invoicing",
        keywords: ["sales", "order", "quotation", "سفارش", "پیش‌فاکتور", "حواله", "فروش", "سطح قیمت"],
      },
      {
        href: "/app/invoicing",
        label: "صورتحساب‌ها",
        icon: "ReceiptText",
        module: "invoicing",
        keywords: ["invoice", "فاکتور", "پیش‌فاکتور", "quotes", "مرجوعی", "returns", "صورتحساب"],
      },
      {
        href: "/app/invoicing/pos",
        label: "پایانه فروش",
        icon: "ShoppingCart",
        module: "invoicing",
        keywords: ["pos", "صندوق", "فروش سریع", "آفلاین"],
      },
      {
        href: "/app/crm",
        label: "مشتریان و طرف‌حساب‌ها",
        icon: "Contact",
        module: "crm",
        keywords: ["customer", "lead", "مشتری", "سرنخ", "crm"],
      },
    ],
  },
  {
    id: "purchase-stock",
    label: "خرید و انبار",
    icon: "Boxes",
    items: [
      {
        href: "/app/inventory",
        label: "کالا و انبارداری",
        icon: "Warehouse",
        module: "inventory",
        keywords: ["stock", "warehouse", "کالا", "انبار", "موجودی", "رسید", "خرید", "هزینه"],
      },
      {
        href: "/app/inventory/production",
        label: "فرمول ساخت و تولید",
        icon: "Factory",
        module: "inventory",
        keywords: ["bom", "production", "تولید", "فرمول ساخت", "ضایعات"],
      },
      {
        href: "/app/inventory/reports",
        label: "گزارش‌های انبار و کاردکس",
        icon: "Boxes",
        module: "inventory",
        keywords: ["کاردکس", "گزارش انبار", "موجودی کالا", "نقطه سفارش", "کسری"],
      },
    ],
  },
  {
    id: "money",
    label: "پول",
    icon: "Landmark",
    items: [
      {
        href: "/app/money",
        label: "مدیریت وجوه و خزانه‌داری",
        icon: "Landmark",
        module: "banking",
        keywords: ["money", "بانک", "چک", "صندوق", "تنخواه", "خسارت", "پول", "خزانه‌داری"],
      },
    ],
  },
  {
    id: "people",
    label: "کارکنان",
    icon: "UsersRound",
    items: [
      {
        href: "/app/hr",
        label: "پرسنل و احکام",
        icon: "UsersRound",
        module: "hr",
        keywords: ["پرسنل", "کارمند", "استخدام", "قرارداد", "احکام", "مرخصی"],
      },
      {
        href: "/app/hr/attendance",
        label: "کارکرد و تردد",
        icon: "CalendarCheck",
        module: "hr",
        keywords: ["کارکرد", "تردد", "حضور و غیاب", "ساعت کار", "شیفت"],
      },
      {
        href: "/app/hr/payroll",
        label: "حقوق ماهانه",
        icon: "Calculator",
        module: "hr",
        keywords: ["حقوق", "دستمزد", "فیش", "payroll"],
      },
      {
        href: "/app/hr/statutory",
        label: "بیمه و مالیات حقوق",
        icon: "ClipboardList",
        module: "hr",
        keywords: ["بیمه", "مالیات حقوق", "تامین اجتماعی"],
      },
    ],
  },
  {
    id: "accounting-tax",
    label: "حسابداری و مالیات",
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
        href: "/app/accounting/fiscal-years",
        label: "سال‌های مالی",
        icon: "Calendar",
        module: "accounting",
        keywords: ["fiscal", "year", "سال مالی", "دوره مالی", "بستن حساب"],
      },
      {
        href: "/app/accounting/recurring-vouchers",
        label: "اسناد مکرر",
        icon: "RotateCcw",
        module: "accounting",
        keywords: ["recurring", "اسناد مکرر", "الگوی سند", "خودکار"],
      },
      {
        href: "/app/accounting/fixed-assets",
        label: "اموال و دارایی‌های ثابت",
        icon: "Building",
        module: "accounting",
        keywords: ["assets", "اموال", "دارایی", "استهلاک", "پلاک"],
      },
      {
        href: "/app/accounting/dimensions",
        label: "تفصیلی شناور و مراکز",
        icon: "Layers",
        module: "accounting",
        keywords: ["dimension", "مرکز هزینه", "پروژه", "تفصیلی شناور"],
      },
      {
        href: "/app/contracting",
        label: "پروژه‌ها و قراردادها",
        icon: "Briefcase",
        module: "accounting",
        keywords: ["contract", "پیمانکاری", "قرارداد", "پروژه"],
      },
      {
        href: "/app/tax",
        label: "مالیات و مودیان",
        icon: "Landmark",
        module: "tax",
        keywords: ["سامانه مودیان", "مالیات", "ارزش افزوده", "صورتحساب الکترونیکی"],
      },
      {
        href: "/app/tax/previews",
        label: "پیش‌نمایش‌های مالیاتی",
        icon: "Calculator",
        module: "tax",
        keywords: ["پیش‌نمایش مالیات", "مالیات شرکت‌ها", "مشاغل", "اجاره", "تکلیفی پزشکان", "محاسبه مالیات"],
      },
      {
        href: "/app/tax/electronic-books",
        label: "دفاتر تجاری الکترونیکی",
        icon: "FileSpreadsheet",
        module: "tax",
        keywords: ["دفاتر الکترونیک", "دفتر کل", "دفتر روزنامه", "سامانه ثبت دفاتر"],
      },
    ],
  },
  {
    id: "reports",
    label: "گزارش‌ها",
    icon: "ChartColumn",
    items: [
      {
        href: "/app/reports",
        label: "مرکز گزارش‌ها",
        icon: "ChartColumn",
        module: "accounting",
        keywords: [
          "reports",
          "صورت‌های مالی",
          "ترازنامه",
          "سود و زیان",
          "دفاتر",
          "تلفیقی",
          "مراکز هزینه",
          "بودجه",
          "پژوهش حقوقی",
        ],
      },
      {
        href: "/app/reports/gross-profit",
        label: "سود ناخالص",
        icon: "TrendingUp",
        module: "invoicing",
        keywords: ["سود ناخالص", "حاشیه سود", "بهای تمام شده", "gross profit", "cogs"],
      },
      {
        href: "/app/reports/cheques",
        label: "گزارش چک‌ها",
        icon: "Banknote",
        module: "cheques",
        keywords: ["چک", "پرتفوی چک", "چک برگشتی", "سررسید چک", "بانک"],
      },
      {
        href: "/app/accounting/report-builder",
        label: "گزارش‌ساز",
        icon: "FileSpreadsheet",
        module: "accounting",
        keywords: ["builder", "custom report", "گزارش سفارشی", "گزارش‌ساز"],
      },
    ],
  },
];

/** Pinned settings hub in the shell footer. */
export const SETTINGS_ITEM: MenuLeaf = {
  href: "/app/settings",
  label: "تنظیمات",
  icon: "Settings",
  keywords: ["تنظیمات", "اعضا", "نقش‌ها", "امنیت", "settings", "ماژول‌ها", "ورود اطلاعات"],
};

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
    id: "new-invoice",
    label: "صورتحساب جدید",
    href: "/app/invoicing?new=1",
    module: "invoicing",
    action: "create",
    keywords: ["فاکتور جدید", "صدور", "new bill", "invoice"],
    icon: "Plus",
  },
  {
    id: "new-voucher",
    label: "سند حسابداری جدید",
    href: "/app/accounting/vouchers?new=1",
    module: "accounting",
    action: "create",
    keywords: ["سند جدید", "ثبت سند", "voucher", "journal"],
    icon: "ReceiptText",
  },
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
