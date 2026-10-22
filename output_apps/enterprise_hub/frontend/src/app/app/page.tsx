"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileUp, LayoutDashboard } from "lucide-react";

import {
  ErrorNotice,
  PageHeader,
  StatCard,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { getTrialBalance } from "@/lib/api/accounting-client";
import { getLeadStats } from "@/lib/api/crm-client";
import { getHrStats } from "@/lib/api/hr-client";
import { getFifoValuation } from "@/lib/api/inventory-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
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

function useSlice<T>(load: (signal: AbortSignal) => Promise<T>): Slice<T> {
  const [slice, setSlice] = useState<Slice<T>>(emptySlice<T>());
  useEffect(() => {
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
  }, []);
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

export default function SuiteDashboardPage() {
  const crm = useSlice<LeadStats>((s) => getLeadStats(s));
  const hr = useSlice<HrStats>((s) => getHrStats(s));
  const inventory = useSlice<FifoValuationResponse>((s) => getFifoValuation(s));
  const accounting = useSlice<TrialBalanceResponse>((s) => getTrialBalance(s));

  const allEmpty =
    !crm.loading &&
    !hr.loading &&
    !inventory.loading &&
    !accounting.loading &&
    (crm.data?.totalLeads ?? 0) === 0 &&
    (hr.data?.totalEmployees ?? 0) === 0 &&
    (inventory.data?.itemCount ?? 0) === 0 &&
    (accounting.data?.rows.length ?? 0) === 0;

  return (
    <>
      <PageHeader
        title="داشبورد"
        description="خلاصه‌ای از وضعیت کسب‌وکار شما در یک نگاه"
        icon={<LayoutDashboard className="size-6 text-indigo-500" />}
      />

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

      <Section title="مشتریان (CRM)" slice={crm}>
        <StatCard
          label="کل سرنخ‌ها"
          value={formatNumber(crm.data?.totalLeads)}
          href="/app/crm"
        />
        <StatCard
          label="سرنخ‌های باز"
          value={formatNumber(crm.data?.openLeads)}
          href="/app/crm"
        />
        <StatCard
          label="ارزش فرصت‌های باز"
          value={formatMoneyRial(crm.data?.openPipelineValue)}
          href="/app/crm"
        />
        <StatCard
          label="درآمد تحقق‌یافته"
          value={formatMoneyRial(crm.data?.wonRevenue)}
          href="/app/crm"
        />
      </Section>

      <Section title="کارکنان (HR)" slice={hr}>
        <StatCard
          label="کل کارکنان"
          value={formatNumber(hr.data?.totalEmployees)}
          href="/app/hr"
        />
        <StatCard
          label="فعال"
          value={formatNumber(hr.data?.activeEmployees)}
          href="/app/hr"
        />
        <StatCard
          label="قراردادهای فعال"
          value={formatNumber(hr.data?.activeContracts)}
          href="/app/hr"
        />
        <StatCard
          label="جمع حقوق پایه"
          value={formatMoneyRial(hr.data?.totalBaseSalary)}
          href="/app/hr"
        />
      </Section>

      <Section title="کالا و انبار" slice={inventory}>
        <StatCard
          label="تعداد کالا"
          value={formatNumber(inventory.data?.itemCount)}
          href="/app/inventory"
        />
        <StatCard
          label="کالاهای زیر حد کسری"
          value={formatNumber(inventory.data?.lowStockCount)}
          href="/app/inventory"
        />
        <StatCard
          label="ارزش موجودی (FIFO)"
          value={formatMoneyRial(inventory.data?.totalInventoryValue)}
          href="/app/inventory"
        />
        <StatCard
          label="دسته‌های باز"
          value={formatNumber(inventory.data?.totalOpenBatches)}
          href="/app/inventory"
        />
      </Section>

      <Section title="حساب‌ها" slice={accounting}>
        <StatCard
          label="حساب‌های دارای گردش"
          value={formatNumber(accounting.data?.rows.length)}
          href="/app/accounting"
        />
        <StatCard
          label="جمع بدهکار"
          value={formatMoneyRial(accounting.data?.totalDebit)}
          href="/app/accounting"
        />
        <StatCard
          label="جمع بستانکار"
          value={formatMoneyRial(accounting.data?.totalCredit)}
          href="/app/accounting"
        />
        <StatCard
          label="وضعیت تراز"
          value={accounting.data?.balanced ? "تراز است" : "تراز نیست"}
          href="/app/accounting"
        />
      </Section>
    </>
  );
}
