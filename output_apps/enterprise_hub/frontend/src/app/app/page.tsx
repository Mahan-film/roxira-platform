"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Boxes,
  Calculator,
  CalendarClock,
  CheckCheck,
  CreditCard,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  FileUp,
  History,
  Kanban,
  Landmark,
  LayoutDashboard,
  PlusCircle,
  Receipt,
  Scale,
  Shield,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";

import {
  ErrorNotice,
  PageHeader,
  StatCard,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { useAccess } from "@/components/app/access-provider";
import { PasswordSettingsCard } from "@/components/auth/password-settings-card";
import { OnboardingBanner } from "@/components/onboarding/onboarding-banner";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getTrialBalance } from "@/lib/api/accounting-client";
import { getLeadStats } from "@/lib/api/crm-client";
import { getHrStats } from "@/lib/api/hr-client";
import { getFifoValuation } from "@/lib/api/inventory-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { getRoleQuickActionDefs, isSalaryVisibleForRole } from "@/lib/role-home";
import { SYSTEM_ROLE_LABELS } from "@/types/access";
import type { TrialBalanceResponse } from "@/types/accounting";
import type { LeadStats } from "@/types/crm";
import type { HrStats } from "@/types/hr";
import type { FifoValuationResponse } from "@/types/inventory";

/** One module's slice of the dashboard; each loads (and fails) independently. */
interface Slice<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

function emptySlice<T>(): Slice<T> {
  return { data: null, error: null, loading: true };
}

function useSlice<T>(load: (signal: AbortSignal) => Promise<T>, enabled = true): Slice<T> {
  const [slice, setSlice] = useState<Slice<T>>(emptySlice<T>());
  useEffect(() => {
    // A module the organisation lacks (or the role cannot read) is neither fetched nor shown.
    if (!enabled) return;
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => setSlice({ data, error: null, loading: false }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSlice({ data: null, error: loadErrorMessage(error), loading: false });
      });
    return () => controller.abort();
    // `load` is a stable module-level function in every call site below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return slice;
}

function Section({
  title,
  slice,
  children,
}: {
  title: string;
  slice: Slice<unknown>;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-muted-foreground">{title}</h2>
      {slice.loading ? (
        <Skeleton className="h-20 w-full" />
      ) : slice.error ? (
        <ErrorNotice title={`خطا در دریافت ${title}`} message={slice.error} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
      )}
    </section>
  );
}

function renderActionIcon(iconName: string) {
  switch (iconName) {
    case "PlusCircle":
      return <PlusCircle className="size-4" />;
    case "BookOpen":
      return <BookOpen className="size-4" />;
    case "FileBarChart":
      return <FileBarChart className="size-4" />;
    case "Receipt":
      return <Receipt className="size-4" />;
    case "CreditCard":
      return <CreditCard className="size-4" />;
    case "Landmark":
      return <Landmark className="size-4" />;
    case "UserPlus":
      return <UserPlus className="size-4" />;
    case "Kanban":
      return <Kanban className="size-4" />;
    case "Boxes":
      return <Boxes className="size-4" />;
    case "CheckCheck":
      return <CheckCheck className="size-4" />;
    case "CalendarClock":
      return <CalendarClock className="size-4" />;
    case "Scale":
      return <Scale className="size-4" />;
    case "Users":
      return <Users className="size-4" />;
    case "Calculator":
      return <Calculator className="size-4" />;
    case "FileText":
      return <FileText className="size-4" />;
    case "ShieldCheck":
      return <ShieldCheck className="size-4" />;
    case "FileSpreadsheet":
      return <FileSpreadsheet className="size-4" />;
    case "FileUp":
      return <FileUp className="size-4" />;
    case "History":
      return <History className="size-4" />;
    default:
      return <BookOpen className="size-4" />;
  }
}

export default function SuiteDashboardPage() {
  const { can, org } = useAccess();
  const roleKey = org?.roleKey ?? "owner";
  const quickActions = getRoleQuickActionDefs(roleKey);
  const showSalary = isSalaryVisibleForRole(roleKey);

  const showCrm = can("crm");
  const showHr = can("hr");
  const showInventory = can("inventory");
  const showAccounting = can("accounting");
  const crm = useSlice<LeadStats>((s) => getLeadStats(s), showCrm);
  const hr = useSlice<HrStats>((s) => getHrStats(s), showHr);
  const inventory = useSlice<FifoValuationResponse>((s) => getFifoValuation(s), showInventory);
  const accounting = useSlice<TrialBalanceResponse>((s) => getTrialBalance(s), showAccounting);

  const allEmpty =
    can("data_import", "create") &&
    (!showCrm || !crm.loading) &&
    (!showHr || !hr.loading) &&
    (!showInventory || !inventory.loading) &&
    (!showAccounting || !accounting.loading) &&
    (crm.data?.totalLeads ?? 0) === 0 &&
    (hr.data?.totalEmployees ?? 0) === 0 &&
    (inventory.data?.itemCount ?? 0) === 0 &&
    (accounting.data?.rows.length ?? 0) === 0;

  return (
    <>
      <PageHeader
        title="داشبورد سازمانی"
        description="خلاصه‌ای از وضعیت کسب‌وکار و دسترسی‌های متناسب با نقش شما"
        icon={<LayoutDashboard className="size-6 text-indigo-500" />}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">نقش فعال:</span>
            <Badge variant="outline" className="border-indigo-500/40 bg-indigo-500/10 font-semibold text-indigo-700 dark:text-indigo-400">
              <Shield className="size-3 me-1 text-indigo-500" />
              {SYSTEM_ROLE_LABELS[roleKey] ?? roleKey}
            </Badge>
          </div>
        }
      />

      <OnboardingBanner />

      {/* Role-tailored workspace banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-gradient-to-l from-indigo-500/10 via-background to-muted/30 p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500">
            <Shield className="size-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">میز کار نقش {SYSTEM_ROLE_LABELS[roleKey] ?? roleKey}</span>
              <Badge variant="secondary" className="text-xs">
                {SYSTEM_ROLE_LABELS[roleKey] ?? roleKey}
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              دسترسی‌های سریع و شاخص‌های متناسب با وظایف شما در سازمان
            </span>
          </div>
        </div>
        {org?.branchScoped && org.branchId && (
          <Badge variant="outline" className="text-xs">
            شعبه: {org.branchId}
          </Badge>
        )}
      </div>

      {/* Role-tailored Quick Actions */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-muted-foreground">دسترسی‌های سریع</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {quickActions.map((action) => (
            <Link
              key={action.title}
              href={action.href}
              className="flex flex-col items-center gap-2 rounded-xl border bg-card p-3 text-center transition-all hover:-translate-y-0.5 hover:border-indigo-500/50 hover:shadow-sm"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                {renderActionIcon(action.iconName)}
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold">{action.title}</span>
                <span className="text-[10px] text-muted-foreground line-clamp-1">{action.description}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {allEmpty && (
        <Link
          href="/app/import"
          className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-indigo-500/40 bg-indigo-500/5 p-5 transition-colors hover:bg-indigo-500/10"
        >
          <FileUp className="size-8 shrink-0 text-indigo-400" aria-hidden="true" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-bold">
              با رها کردن یک فایل شروع کنید
            </span>
            <span className="text-xs text-muted-foreground">
              فایل اکسل مشتریان، کارکنان، کالاها یا سرفصل حساب‌های قبلی‌تان را
              اینجا رها کنید؛ بقیه کار با ماست.
            </span>
          </span>
        </Link>
      )}

      {showCrm && (
        <Section title="مشتریان (CRM)" slice={crm}>
          <StatCard
            label="کل سرنخ‌ها"
            value={formatNumber(crm.data?.totalLeads)}
            href="/app/crm"
            hint="فهرست همه سرنخ‌ها"
          />
          <StatCard
            label="سرنخ‌های باز"
            value={formatNumber(crm.data?.openLeads)}
            href="/app/crm?view=board"
            hint="پایپ‌لاین مراحل باز"
          />
          <StatCard
            label="ارزش فرصت‌های باز"
            value={formatMoneyRial(crm.data?.openPipelineValue)}
            href="/app/crm?view=board"
            hint="ارزش هر مرحله در پایپ‌لاین"
          />
          <StatCard
            label="درآمد تحقق‌یافته"
            value={formatMoneyRial(crm.data?.wonRevenue)}
            href="/app/crm?stage=WON"
            hint="سرنخ‌های برنده‌شده"
          />
        </Section>
      )}

      {showHr && (
        <Section title="کارکنان (HR)" slice={hr}>
          <StatCard
            label="کل کارکنان"
            value={formatNumber(hr.data?.totalEmployees)}
            href="/app/hr"
            hint="فهرست کارکنان"
          />
          <StatCard
            label="فعال"
            value={formatNumber(hr.data?.activeEmployees)}
            href="/app/hr?status=ACTIVE"
            hint="فقط کارکنان شاغل"
          />
          <StatCard
            label="قراردادهای فعال"
            value={formatNumber(hr.data?.activeContracts)}
            href="/app/hr#contracts"
            hint="قراردادهای حقوقی"
          />
          {showSalary ? (
            <StatCard
              label="جمع حقوق پایه"
              value={formatMoneyRial(hr.data?.totalBaseSalary)}
              href="/app/hr/payroll"
              hint="محاسبه حقوق ماهانه"
            />
          ) : (
            <StatCard
              label="احکام پرسنلی"
              value={formatNumber(hr.data?.activeContracts)}
              href="/app/hr"
              hint="سوابق کارگزینی"
            />
          )}
        </Section>
      )}

      {showInventory && (
        <Section title="کالا و انبار" slice={inventory}>
          <StatCard
            label="تعداد کالا"
            value={formatNumber(inventory.data?.itemCount)}
            href="/app/inventory"
            hint="فهرست کالاها"
          />
          <StatCard
            label="کالاهای زیر حد کسری"
            value={formatNumber(inventory.data?.lowStockCount)}
            href="/app/inventory"
            hint="کالاهای رو به اتمام در انبار"
          />
          <StatCard
            label="ارزش موجودی (FIFO)"
            value={formatMoneyRial(inventory.data?.totalInventoryValue)}
            href="/app/inventory"
            hint="ارزش‌گذاری موجودی"
          />
          <StatCard
            label="دسته‌های باز"
            value={formatNumber(inventory.data?.totalOpenBatches)}
            href="/app/inventory"
            hint="دسته‌های خرید باقی‌مانده"
          />
        </Section>
      )}

      {showAccounting && (
        <Section title="حساب‌ها" slice={accounting}>
          <StatCard
            label="حساب‌های دارای گردش"
            value={formatNumber(accounting.data?.rows.length)}
            href="/app/accounting"
            hint="درخت حساب‌ها"
          />
          <StatCard
            label="جمع بدهکار"
            value={formatMoneyRial(accounting.data?.totalDebit)}
            href="/app/accounting/reports"
            hint="تراز آزمایشی"
          />
          <StatCard
            label="جمع بستانکار"
            value={formatMoneyRial(accounting.data?.totalCredit)}
            href="/app/accounting/reports"
            hint="تراز آزمایشی"
          />
          <StatCard
            label="وضعیت تراز"
            value={accounting.data?.balanced ? "تراز است" : "تراز نیست"}
            href="/app/accounting/reports"
            hint="بررسی تراز در گزارش‌ها"
          />
        </Section>
      )}

      <PasswordSettingsCard locale="fa" />
    </>
  );
}
