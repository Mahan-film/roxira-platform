/**
 * Pure helpers defining role-tailored dashboards, quick actions, and field-level visibility.
 * Tested offline with node --test.
 */

export interface RoleQuickActionDef {
  title: string;
  description: string;
  href: string;
  iconName: string;
}

/**
 * Field-level visibility rule matching backend `catalogue.ts`:
 * - `salary` is visible ONLY to `owner` and `hr` by default (never `admin`, `accountant` or `read_only`).
 */
export function isSalaryVisibleForRole(roleKey?: string | null): boolean {
  return roleKey === "owner" || roleKey === "hr";
}

/**
 * Returns role-appropriate quick actions for the suite dashboard.
 */
export function getRoleQuickActionDefs(roleKey: string): RoleQuickActionDef[] {
  switch (roleKey) {
    case "accountant":
      return [
        {
          title: "ثبت سند جدید",
          description: "ثبت سند دوبل حسابداری",
          href: "/app/accounting",
          iconName: "PlusCircle",
        },
        {
          title: "دفتر روزنامه",
          description: "فهرست و چرخه اسناد",
          href: "/app/accounting",
          iconName: "BookOpen",
        },
        {
          title: "تراز آزمایشی",
          description: "گزارش موازنه دفاتر",
          href: "/app/accounting/reports",
          iconName: "FileBarChart",
        },
        {
          title: "صورتحساب‌ها",
          description: "فاکتورهای رسمی و مودیان",
          href: "/app/invoicing",
          iconName: "Receipt",
        },
        {
          title: "اسناد و چک‌ها",
          description: "چک‌های صیادی و سررسید",
          href: "/app/cheques",
          iconName: "CreditCard",
        },
        {
          title: "مغایرت بانکی",
          description: "تطبیق تراکنش‌های بانک",
          href: "/app/accounting/bank/reconcile",
          iconName: "Landmark",
        },
      ];

    case "sales":
      return [
        {
          title: "ثبت سرنخ",
          description: "مشتری یا فرصت جدید",
          href: "/app/crm",
          iconName: "UserPlus",
        },
        {
          title: "تابلوی پایپ‌لاین",
          description: "مراحل پیشرفت فروش",
          href: "/app/crm?view=board",
          iconName: "Kanban",
        },
        {
          title: "صدور فاکتور",
          description: "فاکتور فروش کالا و خدمات",
          href: "/app/invoicing",
          iconName: "Receipt",
        },
        {
          title: "موجودی انبار",
          description: "استعلام موجودی کالاها",
          href: "/app/inventory",
          iconName: "Boxes",
        },
      ];

    case "cheque_reviewer":
      return [
        {
          title: "چک‌های دریافتی",
          description: "کارتابل بررسی و تأیید چک",
          href: "/app/cheques?tab=received",
          iconName: "CheckCheck",
        },
        {
          title: "چک‌های صادرشده",
          description: "پیگیری سررسید چک‌های پرداختی",
          href: "/app/cheques?tab=issued",
          iconName: "CalendarClock",
        },
        {
          title: "مغایرت بانکی",
          description: "تطبیق اسناد بانکی",
          href: "/app/accounting/bank/reconcile",
          iconName: "Landmark",
        },
        {
          title: "تراز اسناد دریافتنی",
          description: "مانده اسناد در دفتر کل",
          href: "/app/accounting/reports",
          iconName: "Scale",
        },
      ];

    case "hr":
      return [
        {
          title: "لیست پرسنل",
          description: "پرونده و سوابق کارکنان",
          href: "/app/hr",
          iconName: "Users",
        },
        {
          title: "حقوق و دستمزد",
          description: "محاسبه ماهانه و ثبت سند",
          href: "/app/hr/payroll",
          iconName: "Calculator",
        },
        {
          title: "قراردادهای کار",
          description: "احکام و مفاد کارگزینی",
          href: "/app/hr#contracts",
          iconName: "FileText",
        },
        {
          title: "مقادیر قانونی",
          description: "نرخ‌های بیمه، مالیات و معافیت",
          href: "/app/hr/statutory",
          iconName: "Scale",
        },
      ];

    case "owner":
    case "admin":
      return [
        {
          title: "اعضا و دسترسی‌ها",
          description: "نقش‌ها و اختیارات کاربران",
          href: "/app/settings/members",
          iconName: "Users",
        },
        {
          title: "سیاست‌های مالی",
          description: "کنترل سقف اعتبار و تخفیف",
          href: "/app/settings/policies",
          iconName: "ShieldCheck",
        },
        {
          title: "سازنده گزارش‌ها",
          description: "طراحی پرس‌وجوهای سفارشی",
          href: "/app/accounting/report-builder",
          iconName: "FileSpreadsheet",
        },
        {
          title: "تراز آزمایشی",
          description: "گزارش وضعیت مالی و دفاتر",
          href: "/app/accounting/reports",
          iconName: "FileBarChart",
        },
        {
          title: "ورود اکسل",
          description: "درون‌ریزی سریع اطلاعات",
          href: "/app/import",
          iconName: "FileUp",
        },
        {
          title: "لاگ حسابرسی",
          description: "ردگیری رخدادهای امنیتی",
          href: "/app/settings/audit",
          iconName: "History",
        },
      ];

    default:
      return [
        {
          title: "تراز آزمایشی",
          description: "مشاهده دفاتر و مانده‌ها",
          href: "/app/accounting/reports",
          iconName: "FileBarChart",
        },
        {
          title: "دفتر روزنامه",
          description: "مرور اسناد حسابداری",
          href: "/app/accounting",
          iconName: "BookOpen",
        },
        {
          title: "موجودی انبار",
          description: "گزارش ارزش و کاردکس کالا",
          href: "/app/inventory",
          iconName: "Boxes",
        },
        {
          title: "صورتحساب‌ها",
          description: "فهرست صورتحساب‌های صادره",
          href: "/app/invoicing",
          iconName: "Receipt",
        },
      ];
  }
}
