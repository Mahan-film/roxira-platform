"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Loader2, Search, UsersRound } from "lucide-react";

import { EmployeeForm } from "@/components/hr/employee-form";
import { EmployeeTable } from "@/components/hr/employee-table";
import { HrStatsCards } from "@/components/hr/hr-stats";
import { PayslipHistoryTable } from "@/components/hr/payslip-history-table";
import { PayslipPreview } from "@/components/hr/payslip-preview";
import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getHrStats, listEmployees, listPayslips } from "@/lib/api/hr-client";
import { ApiClientError } from "@/lib/api/http-client";
import {
  EMPLOYEE_STATUS_LABELS,
  EmployeeStatus,
  type Employee,
  type HrStats,
  type Payslip,
} from "@/types/hr";

/**
 * صفحه جامع منابع انسانی و حقوق و دستمزد.
 *
 * شامل کارت‌های بنتو تحلیلی، فرم کارگزینی پرسنل، جدول پرسنل، پیش‌نمایش و
 * صدور فیش حقوقی (با ثبت خودکار سند هزینه در دفتر روزنامه) و سابقه فیش‌ها
 * — همه متصل به ماژول `enterprise-hub/hr` در لایه NestJS.
 */
export default function HrPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stats, setStats] = useState<HrStats | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<EmployeeStatus | "ALL">(
    "ALL",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  const loadOverview = useCallback(
    (signal?: AbortSignal) => {
      startTransition(async () => {
        try {
          const [employeesResult, statsResult, payslipsResult] =
            await Promise.all([
              listEmployees(
                {
                  limit: 50,
                  search: search.trim() || undefined,
                  status: statusFilter === "ALL" ? undefined : statusFilter,
                },
                signal,
              ),
              getHrStats(signal),
              listPayslips({ limit: 20 }, signal),
            ]);
          setEmployees(employeesResult.data);
          setStats(statsResult);
          setPayslips(payslipsResult.data);
          setErrorMessage(null);
        } catch (error) {
          if (error instanceof ApiClientError) {
            setErrorMessage(error.details.join(" | "));
          } else if (!(error instanceof DOMException)) {
            setErrorMessage(
              "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
            );
          }
        }
      });
    },
    [search, statusFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview, refreshKey]);

  function handleRefresh() {
    setRefreshKey((key) => key + 1);
  }

  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <UsersRound className="size-6 text-indigo-500" />
            منابع انسانی و حقوق و دستمزد
          </h1>
          <p className="text-sm text-muted-foreground">
            کارگزینی پرسنل، احکام حقوقی، محاسبه حقوق (بن خواربار، حق مسکن،
            بیمه ۷٪ و مالیات پله‌ای) و صدور فیش با ثبت خودکار سند — متصل به{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              /enterprise-hub/hr
            </code>
          </p>
        </div>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>خطا در دریافت اطلاعات منابع انسانی</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <HrStatsCards stats={stats} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <EmployeeForm onCreated={handleRefresh} />
          </div>

          <Card className="h-full border-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent ring-1 ring-indigo-500/20">
            <CardHeader>
              <CardTitle>فرمول محاسبه حقوق</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>
                حقوق ناخالص = حقوق پایه + حق مسکن + بن خواربار + حق اولاد +
                اضافه‌کاری.
              </p>
              <p>
                بیمه سهم کارگر ۷٪ از حقوق ناخالص کسر می‌شود؛ مالیات بر مازاد
                معافیت ماهانه به‌صورت پله‌ای (۱۰٪، ۱۵٪ و ۲۰٪) محاسبه می‌گردد.
              </p>
              <p className="font-medium text-foreground">
                خالص پرداختی = ناخالص − بیمه − مالیات − سایر کسورات.
              </p>
              <p className="text-xs">
                با صدور فیش، سند هزینه حقوق به‌صورت خودکار در دفتر روزنامه
                حسابداری ثبت می‌شود (بدهکار ۵۰۱۰ / بستانکار ۲۰۱۰ و ۱۰۱۰).
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جست‌وجو در نام، کد پرسنلی یا کد ملی"
              className="pr-8"
            />
          </div>
          <div className="flex items-center gap-3">
            <Select<EmployeeStatus | "ALL">
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value ?? "ALL")}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="وضعیت استخدامی" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">همه وضعیت‌ها</SelectItem>
                {Object.values(EmployeeStatus).map((status) => (
                  <SelectItem key={status} value={status}>
                    {EMPLOYEE_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isPending && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                در حال به‌روزرسانی...
              </span>
            )}
          </div>
        </div>

        <EmployeeTable
          employees={employees}
          selectedEmployeeId={selectedEmployee?.id ?? null}
          isLoading={isPending}
          onSelect={(employee) =>
            setSelectedEmployee((current) =>
              current?.id === employee.id ? null : employee,
            )
          }
          onRefresh={handleRefresh}
        />

        {selectedEmployee && (
          <PayslipPreview
            employee={selectedEmployee}
            onIssued={() => handleRefresh()}
          />
        )}

        <PayslipHistoryTable payslips={payslips} isLoading={isPending} />
      </main>
      <RoxiraFooter />
    </div>
  );
}
