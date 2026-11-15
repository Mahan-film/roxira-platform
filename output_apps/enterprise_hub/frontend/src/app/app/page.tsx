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
import {
  HomeAlertsFeed,
  HomeAssistantInput,
  HomeKpiTiles,
} from "@/components/home";
import { getTrialBalance } from "@/lib/api/accounting-client";
import { getDashboard } from "@/lib/api/accounting-reports-client";
import { listSessions } from "@/lib/api/bank-recon-client";
import { listDueCheques } from "@/lib/api/cheques-client";
import { getLeadStats } from "@/lib/api/crm-client";
import { getHrStats } from "@/lib/api/hr-client";
import { getFifoValuation } from "@/lib/api/inventory-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import {
  buildHomeAlerts,
  computeCashNow,
  isProfitVisibleForUser,
} from "@/lib/home-hub";
import { getRoleQuickActionDefs, isSalaryVisibleForRole } from "@/lib/role-home";
import { SYSTEM_ROLE_LABELS } from "@/types/access";
import type { TrialBalanceResponse } from "@/types/accounting";
import type { DashboardReport } from "@/types/accounting-reports";
import type { ReconSession } from "@/lib/api/bank-recon-client";
import type { DueCheques } from "@/types/cheques";
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

const fetchDashboard = (signal: AbortSignal) => getDashboard({}, signal);
const fetchDueCheques = (signal: AbortSignal) => listDueCheques(7, signal);
const fetchBankSessions = () => listSessions();

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

  const showCrm = can("crm", "read");
  const showHr = can("hr", "read");
  const showInventory = can("inventory", "read");
  const showAccounting = can("accounting", "read");
  const showCheques = can("cheques", "read");
  const showBanking = can("banking", "read");

  const crm = useSlice<LeadStats>(getLeadStats, showCrm);
  const hr = useSlice<HrStats>(getHrStats, showHr);
  const inventory = useSlice<FifoValuationResponse>(getFifoValuation, showInventory);
  const accounting = useSlice<TrialBalanceResponse>(getTrialBalance, showAccounting);
  const dashboard = useSlice<DashboardReport>(fetchDashboard, showAccounting);
  const dueCheques = useSlice<DueCheques>(fetchDueCheques, showCheques);
  const bankSessions = useSlice<ReconSession[]>(fetchBankSessions, showBanking);

  const cashNow = computeCashNow(dashboard.data?.cash, dashboard.data?.bank);
  const salesToday = dashboard.data?.sales ?? 0;
  const profitThisMonth = dashboard.data?.netProfit ?? 0;
  const overdueReceivables = dashboard.data?.receivables ?? 0;
  const isProfitConfidential = !isProfitVisibleForUser(showAccounting, roleKey);

  const homeAlerts = buildHomeAlerts({
    chequesDueCount: dueCheques.data?.items?.length ?? 0,
    chequesDueAmount: dueCheques.data?.issuedTotal ?? 0,
    unmatchedBankLinesCount: bankSessions.data?.filter((s) => s.status !== "COMMITTED")?.length ?? 0,
    lowStockCount: inventory.data?.lowStockCount ?? 0,
    pendingApprovalsCount: 0,
    importExceptionsCount: 0,
  });

  const alertsLoading = dueCheques.loading && bankSessions.loading && inventory.loading;

  return (
    <>
      <PageHeader
        title="خانه و دیده‌بان کسب‌وکار"
        description="خلاصهٔ وضعیت مالی، شاخص‌های کلیدی، خوراک هشدارها و دسترسی سریع."
        icon={<LayoutDashboard className="size-6 text-primary" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 px-3 py-1 text-xs">
              <Shield className="size-3 text-muted-foreground" />
              <span>نقش شما:</span>
              <strong className="font-bold">
                {SYSTEM_ROLE_LABELS[roleKey] ?? roleKey}
              </strong>
            </Badge>
          </div>
        }
      />

      <OnboardingBanner />

      {/* Hero Assistant Input */}
      <HomeAssistantInput />

      {/* 4 KPI Tiles */}
      <HomeKpiTiles
        cashNow={cashNow}
        salesToday={salesToday}
        profitThisMonth={profitThisMonth}
        overdueReceivables={overdueReceivables}
        isProfitConfidential={isProfitConfidential}
        loading={dashboard.loading}
      />

      {/* Alerts Feed and Quick Actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HomeAlertsFeed alerts={homeAlerts} loading={alertsLoading} />
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-bold text-muted-foreground">دسترسی سریع</h2>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
            {quickActions.map((action) => (
              <Link
                key={action.href + action.title}
                href={action.href}
                className="group flex items-start gap-3 rounded-xl border border-border/70 bg-card p-3 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
                  {renderActionIcon(action.iconName)}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold group-hover:text-primary transition-colors">
                    {action.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {action.description}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {can("admin", "read") && (
        <Link
          href="/app/import"
          className="flex items-center gap-4 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-4 transition-colors hover:border-primary/50 hover:bg-primary/10"
        >
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <FileSpreadsheet className="size-6" />
          </div>
          <div className="flex flex-col gap-0.5 text-sm">
            <span className="font-bold text-foreground">
              ورود سریع اطلاعات از نرم‌افزارهای قبلی (سپیدار، همکاران، هلو و اکسل)
            </span>
            <span className="text-xs text-muted-foreground">
              فایل اکسل مشتریان، کارکنان، کالاها یا سرفصل حساب‌های قبلی‌تان را
              اینجا رها کنید؛ بقیه کار با ماست.
            </span>
          </div>
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
            value={formatNumber(accounting.data?.rows?.length)}
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
