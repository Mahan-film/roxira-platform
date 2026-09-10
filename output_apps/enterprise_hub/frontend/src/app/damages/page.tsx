import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { DamageCalculatorSection } from "@/components/damages/damage-calculator-section";
import { DamageHistoryTable } from "@/components/damages/damage-history-table";

export default function DamagesHistoryPage() {
  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            محاسبه‌گر و تاریخچه خسارت تاخیر تادیه
          </h1>
          <p className="text-sm text-muted-foreground">
            محاسبه رسمی بر پایه شاخص بانک مرکزی و ماده ۵۲۲ قانون آیین دادرسی مدنی،
            متصل به{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs" dir="ltr">
              POST/GET /enterprise-hub/damages
            </code>
          </p>
        </div>

        <DamageCalculatorSection />

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">سوابق محاسبات</h2>
          <DamageHistoryTable />
        </section>
      </main>
      <RoxiraFooter />
    </div>
  );
}
