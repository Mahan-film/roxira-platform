"use client";

import { useEffect, useMemo, useState } from "react";
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
  loadErrorMessage,
} from "@/components/app/app-ui";
import { useAccess } from "@/components/app/access-provider";
import { ReportNotes } from "@/components/accounting/reports/report-views";
import { HomeAssistantInput, HomeKpiTiles } from "@/components/home";
import { OnboardingBanner } from "@/components/onboarding/onboarding-banner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { MoneyUnitSwitch } from "@/components/ui/money-unit-switch";
import { getDashboard } from "@/lib/api/accounting-reports-client";
import { formatJalaliDate } from "@/lib/fa-format";
import { computeCashNow, isProfitVisibleForUser } from "@/lib/home-hub";
import { jalaliPresets, todayJalaliIso } from "@/lib/jalali-date-input";
import { useMoneyUnit } from "@/lib/money-unit";
import { getRoleQuickActionDefs } from "@/lib/role-home";
import { SYSTEM_ROLE_LABELS } from "@/types/access";
import type { DashboardReport, ReportQuery } from "@/types/accounting-reports";

interface DashboardState {
  data: DashboardReport | null;
  error: string | null;
  loading: boolean;
}

function useDashboardSummary(query: ReportQuery, enabled: boolean): DashboardState {
  const [state, setState] = useState<DashboardState>({
    data: null,
    error: null,
    loading: enabled,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    getDashboard(query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, error: null, loading: false });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ data: null, error: loadErrorMessage(error), loading: false });
      });
    return () => controller.abort();
  }, [enabled, query]);

  return state;
}

function renderActionIcon(iconName: string) {
  switch (iconName) {
    case "PlusCircle":
      return <PlusCircle className="size-4" aria-hidden="true" />;
    case "BookOpen":
      return <BookOpen className="size-4" aria-hidden="true" />;
    case "FileBarChart":
      return <FileBarChart className="size-4" aria-hidden="true" />;
    case "Receipt":
      return <Receipt className="size-4" aria-hidden="true" />;
    case "CreditCard":
      return <CreditCard className="size-4" aria-hidden="true" />;
    case "Landmark":
      return <Landmark className="size-4" aria-hidden="true" />;
    case "UserPlus":
      return <UserPlus className="size-4" aria-hidden="true" />;
    case "Kanban":
      return <Kanban className="size-4" aria-hidden="true" />;
    case "Boxes":
      return <Boxes className="size-4" aria-hidden="true" />;
    case "CheckCheck":
      return <CheckCheck className="size-4" aria-hidden="true" />;
    case "CalendarClock":
      return <CalendarClock className="size-4" aria-hidden="true" />;
    case "Scale":
      return <Scale className="size-4" aria-hidden="true" />;
    case "Users":
      return <Users className="size-4" aria-hidden="true" />;
    case "Calculator":
      return <Calculator className="size-4" aria-hidden="true" />;
    case "FileText":
      return <FileText className="size-4" aria-hidden="true" />;
    case "ShieldCheck":
      return <ShieldCheck className="size-4" aria-hidden="true" />;
    case "FileSpreadsheet":
      return <FileSpreadsheet className="size-4" aria-hidden="true" />;
    case "FileUp":
      return <FileUp className="size-4" aria-hidden="true" />;
    case "History":
      return <History className="size-4" aria-hidden="true" />;
    default:
      return <BookOpen className="size-4" aria-hidden="true" />;
  }
}

export default function SuiteDashboardPage() {
  const { can, org } = useAccess();
  const [unit] = useMoneyUnit();
  const roleKey = org?.roleKey ?? "owner";
  const quickActions = getRoleQuickActionDefs(roleKey);

  const showAccounting = can("accounting", "read");
  const showAssistant = can("assistant", "read");

  const presets = useMemo(() => jalaliPresets(todayJalaliIso()), []);
  const [presetKey, setPresetKey] = useState<string>("default");
  const [query, setQuery] = useState<ReportQuery>({});

  const dashboard = useDashboardSummary(query, showAccounting);

  const cashNow = computeCashNow(dashboard.data?.cash, dashboard.data?.bank);
  const sales = dashboard.data?.sales ?? null;
  const profit = dashboard.data?.netProfit ?? null;
  const receivables = dashboard.data?.receivables ?? null;
  const payables = dashboard.data?.payables ?? null;
  const taxDue = dashboard.data?.taxDue ?? null;
  const inventory = dashboard.data?.inventory ?? null;

  const hasMarginPermission = Boolean(org?.fieldVisibility?.margin);
  const isProfitConfidential = !isProfitVisibleForUser(hasMarginPermission, roleKey);

  function handlePresetChange(nextKey: string) {
    setPresetKey(nextKey);
    if (nextKey === "default") {
      setQuery({});
      return;
    }
    const found = presets.find((p) => p.key === nextKey);
    if (found) {
      setQuery({ from: found.from, to: found.to });
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="داشبورد مالی و دیده‌بان کسب‌وکار"
        description="خلاصهٔ وضعیت نقدینگی، فروش، سود، مطالبات، بدهی‌ها و مالیات بر مبنای اسناد دفتر کل."
        icon={<LayoutDashboard className="size-6 text-primary" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 px-3 py-1 text-xs">
              <Shield className="size-3 text-muted-foreground" aria-hidden="true" />
              <span>نقش شما:</span>
              <strong className="font-bold">
                {SYSTEM_ROLE_LABELS[roleKey] ?? roleKey}
              </strong>
            </Badge>
            {org?.branchScoped && org.branchId && (
              <Badge variant="outline" className="text-xs">
                شعبه: {org.branchId}
              </Badge>
            )}
          </div>
        }
      />

      <OnboardingBanner />

      {showAssistant && <HomeAssistantInput />}

      {showAccounting ? (
        <section aria-label="تنظیمات دوره و واحد مبلغ" className="flex flex-col gap-4">
          <Card className="border border-border bg-card">
            <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid min-w-0 gap-1 sm:w-44">
                  <Label htmlFor="home-period-preset">بازه گزارش</Label>
                  <select
                    id="home-period-preset"
                    value={presetKey}
                    onChange={(event) => handlePresetChange(event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="default">سال مالی جاری (تا امروز)</option>
                    {presets.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {preset.label}
                      </option>
                    ))}
                    <option value="custom">بازه دلخواه</option>
                  </select>
                </div>

                <div className="grid w-full gap-1 sm:w-36">
                  <Label htmlFor="home-period-from">از تاریخ</Label>
                  <JalaliDateInput
                    id="home-period-from"
                    value={query.from ?? ""}
                    onChange={(from) => {
                      setPresetKey("custom");
                      setQuery((prev) => ({ ...prev, from: from || undefined }));
                    }}
                  />
                </div>

                <div className="grid w-full gap-1 sm:w-36">
                  <Label htmlFor="home-period-to">تا تاریخ</Label>
                  <JalaliDateInput
                    id="home-period-to"
                    value={query.to ?? ""}
                    onChange={(to) => {
                      setPresetKey("custom");
                      setQuery((prev) => ({ ...prev, to: to || undefined }));
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                {dashboard.data?.period && (
                  <span className="text-xs text-muted-foreground">
                    دوره فعال:{" "}
                    <strong className="font-medium text-foreground">
                      {formatJalaliDate(dashboard.data.period.from)} تا{" "}
                      {formatJalaliDate(dashboard.data.period.to)}
                    </strong>
                  </span>
                )}
                <MoneyUnitSwitch />
              </div>
            </CardContent>
          </Card>

          <ErrorNotice title="خطا در دریافت خلاصه مالی" message={dashboard.error} />

          <HomeKpiTiles
            cashNow={cashNow}
            salesToday={sales}
            profitThisMonth={profit}
            overdueReceivables={receivables}
            payables={payables}
            taxDue={taxDue}
            inventory={inventory}
            periodTo={dashboard.data?.period.to ?? null}
            unit={unit}
            isProfitConfidential={isProfitConfidential}
            loading={dashboard.loading}
          />

          {dashboard.data && dashboard.data.inferredAccounts.length > 0 && (
            <ReportNotes inferred={dashboard.data.inferredAccounts} />
          )}
        </section>
      ) : (
        <Card className="border border-border bg-card">
          <CardContent className="p-4 text-sm text-muted-foreground">
            نمایش شاخص‌های خلاصه مالی نیازمند دسترسی مشاهده حسابداری است. از بخش دسترسی سریع زیر برای ورود به صفحات مجاز خود استفاده کنید.
          </CardContent>
        </Card>
      )}

      <section aria-label="دسترسی سریع" className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-foreground">دسترسی سریع</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickActions.map((action) => (
            <Link
              key={action.href + action.title}
              href={action.href}
              className="group flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="mt-0.5 shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
                {renderActionIcon(action.iconName)}
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                  {action.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {action.description}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {can("data_import", "create") && (
        <Link
          href="/app/import"
          className="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-4 transition-colors hover:border-primary/60 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <div className="shrink-0 rounded-xl bg-primary/10 p-3 text-primary">
            <FileSpreadsheet className="size-6" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 text-sm">
            <span className="font-bold text-foreground">
              ورود سریع اطلاعات از نرم‌افزارهای قبلی (سپیدار، همکاران، هلو و اکسل)
            </span>
            <span className="text-xs text-muted-foreground">
              فایل اکسل مشتریان، کارکنان، کالاها یا سرفصل حساب‌های قبلی‌تان را
              اینجا بارگذاری کنید؛ بقیه کار با ماست.
            </span>
          </div>
        </Link>
      )}
    </div>
  );
}
