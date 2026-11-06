"use client";

import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { PageHeader } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Card, CardContent, CardTitle, CardHeader } from "@/components/ui/card";
import { REPORT_GROUPS, reportHref } from "@/lib/reports-hub";

export default function ReportsHubPage() {
  return (
    <EnterpriseRouteGuard requireAdmin>
      <PageHeader
        title="گزارش‌ها"
        description="صورت‌های مالی، دفاتر و مطالبات؛ هر گزارش با دوره، مقایسه و خروجی اکسل یا PDF"
        icon={<FileBarChart className="size-6 text-indigo-500" />}
      />

      <div className="grid gap-6">
        {REPORT_GROUPS.map((group) => (
          <section key={group.id} className="grid gap-3">
            <h2 className="text-lg font-bold">{group.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.reports.map((report) => (
                <Link
                  key={report.key}
                  href={reportHref(report.key)}
                  className="block rounded-xl ring-1 ring-border transition-colors hover:ring-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Card className="min-h-11 border-0 shadow-none">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-base">{report.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 pt-0 text-sm text-muted-foreground">
                      {report.description}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </EnterpriseRouteGuard>
  );
}
