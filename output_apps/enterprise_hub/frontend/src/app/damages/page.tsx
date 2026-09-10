import { SiteHeader } from "@/components/layout/site-header";
import { DamageHistoryTable } from "@/components/damages/damage-history-table";

export default function DamagesHistoryPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/30">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            تاریخچه محاسبات خسارت تاخیر تادیه
          </h1>
          <p className="text-sm text-muted-foreground">
            متصل به{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              GET /enterprise-hub/damages
            </code>{" "}
            با صفحه‌بندی و فیلتر بر اساس شماره قرارداد.
          </p>
        </div>

        <DamageHistoryTable />
      </main>
    </div>
  );
}
