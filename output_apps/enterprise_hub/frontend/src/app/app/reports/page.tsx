"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  FileBarChart,
  FileSpreadsheet,
  Layers,
  PieChart,
  Scale,
} from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { REPORT_GROUPS, reportHref } from "@/lib/reports-hub";
import { cn } from "@/lib/utils";

interface HubTab {
  id: string;
  label: string;
  description: string;
  href?: string;
  icon: typeof FileBarChart;
}

const REPORT_HUB_TABS: HubTab[] = [
  {
    id: "standard",
    label: "گزارش‌های استاندارد",
    description: "صورت‌های مالی، دفاتر روزنامه و کل، تراز آزمایشی و گردش حساب‌ها",
    icon: FileBarChart,
  },
  {
    id: "builder",
    label: "گزارش‌ساز پیشرفته",
    description: "طراحی گزارش‌های سفارشی با انتخاب فیلدها، فیلترها و گروه‌بندی دلخواه",
    href: "/app/accounting/report-builder",
    icon: FileSpreadsheet,
  },
  {
    id: "consolidated",
    label: "صورت‌های تلفیقی",
    description: "تلفیق چند شرکت، شعب و حذف معاملات درون‌گروهی",
    href: "/app/accounting/reports/consolidated",
    icon: Building2,
  },
  {
    id: "cost-centres",
    label: "مراکز هزینه",
    description: "تحلیل سودآوری و هزینه‌کرد پروژه‌ها، دپارتمان‌ها و شعب",
    href: "/app/accounting/reports/cost-centres",
    icon: Layers,
  },
  {
    id: "budget-vs-actual",
    label: "بودجه و عملکرد",
    description: "مقایسه بودجه پیش‌بینی‌شده با ارقام واقعی اسناد و انحرافات",
    href: "/app/accounting/budget-vs-actual",
    icon: PieChart,
  },
  {
    id: "legal",
    label: "پژوهش حقوقی",
    description: "جست‌وجو در قوانین مالیاتی، تجارت، آرای وحدت رویه و بخشنامه‌ها",
    href: "/laws",
    icon: Scale,
  },
];

function ReportsHubContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") ?? "standard";
  const [activeTabId, setActiveTabId] = useState<string>(initialTab);

  const activeTab = REPORT_HUB_TABS.find((t) => t.id === activeTabId) ?? REPORT_HUB_TABS[0];
  const ActiveIcon = activeTab.icon;

  return (
    <>
      <PageHeader
        title="مرکز گزارش‌ها"
        description="صورت‌های مالی، دفاتر، تحلیل مراکز هزینه، بودجه و گزارش‌ساز پیشرفته"
        icon={<FileBarChart className="size-6 text-indigo-400" aria-hidden="true" />}
      />

      {/* Tabs navigation */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {REPORT_HUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTabId === "standard" ? (
        <div className="grid gap-6">
          {REPORT_GROUPS.map((group) => (
            <section key={group.id} className="grid gap-3">
              <h2 className="text-base font-bold text-foreground">{group.title}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.reports.map((report) => (
                  <Link
                    key={report.key}
                    href={reportHref(report.key)}
                    className="block rounded-xl border border-border bg-card p-4 transition-all hover:border-indigo-500/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <div className="text-sm font-semibold text-foreground">{report.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      {report.description}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card className="border border-border bg-card">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                <ActiveIcon className="size-5" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-base">{activeTab.label}</CardTitle>
                <CardDescription className="text-xs">{activeTab.description}</CardDescription>
              </div>
            </div>
            {activeTab.href && (
              <Link href={activeTab.href}>
                <Button size="sm" className="gap-2">
                  <span>مشاهده {activeTab.label}</span>
                  <ArrowLeft className="size-4" aria-hidden="true" />
                </Button>
              </Link>
            )}
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              برای مشاهده کامل، فیلترها و دریافت خروجی اکسل یا چاپی، روی دکمهٔ «مشاهده {activeTab.label}» کلیک کنید.
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

export default function ReportsHubPage() {
  return (
    <EnterpriseRouteGuard>
      <Suspense fallback={<div className="p-8 text-center text-xs text-muted-foreground">در حال بارگذاری گزارش‌ها…</div>}>
        <ReportsHubContent />
      </Suspense>
    </EnterpriseRouteGuard>
  );
}
