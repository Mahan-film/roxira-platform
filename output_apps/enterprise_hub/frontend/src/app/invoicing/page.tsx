"use client";

import { useState } from "react";

import { InvoiceForm } from "@/components/invoicing/invoice-form";
import { InvoiceHistoryTable } from "@/components/invoicing/invoice-history-table";
import { SiteHeader } from "@/components/layout/site-header";

/**
 * صفحه مدیریت و صدور فاکتور هوشمند (Smart Invoicing).
 *
 * شامل فرم داینامیک اقلام کالا/خدمت با محاسبه آنی مالیات ۹٪ و جدول سوابق
 * صورتحساب‌ها است. پس از هر صدور موفق، جدول سوابق خودکار بروزرسانی می‌شود.
 */
export default function InvoicingPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/30">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            سامانه فاکتور هوشمند سازمانی
          </h1>
          <p className="text-sm text-muted-foreground">
            مدیریت و صدور صورتحساب مالیاتی با محاسبه آنی مالیات ۹٪ — متصل به{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              POST/GET /enterprise-hub/invoicing
            </code>
          </p>
        </div>

        <InvoiceForm onCreated={() => setRefreshKey((key) => key + 1)} />

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">سوابق صورتحساب‌ها</h2>
          <InvoiceHistoryTable refreshKey={refreshKey} />
        </section>
      </main>
    </div>
  );
}
