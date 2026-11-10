"use client";

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";

import { ErrorNotice, PageHeader, StatCard, loadErrorMessage } from "@/components/app/app-ui";
import { ReportNotes } from "@/components/accounting/reports/report-views";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboard } from "@/lib/api/accounting-reports-client";
import { formatReportMoney } from "@/lib/fa-format";
import type { DashboardReport } from "@/types/accounting-reports";

export default function AccountingDashboardPage() {
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getDashboard({}, controller.signal)
      .then(setReport)
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  const cards = report
    ? [
        { label: "صندوق و تنخواه", value: report.cash, href: "/app/accounting/petty-cash" },
        { label: "بانک", value: report.bank, href: "/app/accounting/bank" },
        { label: "مطالبات", value: report.receivables },
        { label: "بدهی به تأمین‌کنندگان", value: report.payables },
        { label: "فروش سال جاری", value: report.sales },
        { label: "مالیات پرداختنی", value: report.taxDue },
        { label: "موجودی کالا", value: report.inventory },
        { label: "سود خالص سال جاری", value: report.netProfit, href: "/app/accounting/reports" },
      ]
    : [];

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="داشبورد مدیریتی"
        description="مبالغ به ریال و از اسناد ثبت‌شده در دفتر"
        icon={<Gauge className="size-6 text-indigo-500" />}
      />
      <ErrorNotice title="داشبورد ساخته نشد" message={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {report
          ? cards.map((card) => (
              <StatCard key={card.label} label={card.label} value={formatReportMoney(card.value)} href={card.href} />
            ))
          : !error && Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-20" />)}
      </div>
      {report && <ReportNotes inferred={report.inferredAccounts} />}
    </EnterpriseRouteGuard>
  );
}
