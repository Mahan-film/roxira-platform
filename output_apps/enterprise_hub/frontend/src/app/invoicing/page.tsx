"use client";

import { useState } from "react";

import { InvoiceForm } from "@/components/invoicing/invoice-form";
import { InvoiceHistoryTable } from "@/components/invoicing/invoice-history-table";
import { TaxCompliancePanel } from "@/components/invoicing/tax-compliance-panel";
import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";

type InvoicingTab = "invoices" | "moadian";

const TABS: { id: InvoicingTab; label: string }[] = [
  { id: "invoices", label: "صورتحساب‌ها" },
  { id: "moadian", label: "سامانه مودیان" },
];

/**
 * صفحه مدیریت و صدور فاکتور هوشمند (Smart Invoicing).
 *
 * دو تب:
 * - «صورتحساب‌ها»: فرم داینامیک اقلام با محاسبه آنی مالیات ۹٪ و سوابق.
 * - «سامانه مودیان»: امضای الکترونیک صورتحساب‌ها، کد مالیاتی ۲۲ رقمی،
 *   وضعیت ارسال و دانلود بسته امضاشده.
 */
export default function InvoicingPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<InvoicingTab>("invoices");

  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            سامانه فاکتور هوشمند سازمانی
          </h1>
          <p className="text-sm text-muted-foreground">
            مدیریت و صدور صورتحساب مالیاتی با محاسبه آنی مالیات ۹٪ و امضای
            الکترونیک سامانه مودیان — متصل به{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              /enterprise-hub/invoicing
            </code>{" "}
            و{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              /enterprise-hub/tax-compliance
            </code>
          </p>
        </div>

        <div
          role="tablist"
          className="inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={
                activeTab === tab.id
                  ? "rounded-md bg-background px-4 py-1.5 text-sm font-medium text-foreground shadow-sm"
                  : "rounded-md px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "invoices" ? (
          <>
            <InvoiceForm onCreated={() => setRefreshKey((key) => key + 1)} />

            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">سوابق صورتحساب‌ها</h2>
              <InvoiceHistoryTable refreshKey={refreshKey} />
            </section>
          </>
        ) : (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">
                تطبیق با سامانه مودیان و امضای الکترونیک
              </h2>
              <p className="text-sm text-muted-foreground">
                محاسبه هش، تولید کد مالیاتی یکتا (TaxID) ۲۲ رقمی و امضای دیجیتال
                JWS روی بسته‌های صورتحساب.
              </p>
            </div>
            <TaxCompliancePanel refreshKey={refreshKey} />
          </section>
        )}
      </main>
      <RoxiraFooter />
    </div>
  );
}
