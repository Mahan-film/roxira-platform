"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Pencil, Plus, Search, UsersRound } from "lucide-react";

import {
  EmptyImportState,
  ErrorNotice,
  LoadingLine,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { EmployeeEditPanel } from "@/components/app/employee-edit-panel";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { EmployeeForm } from "@/components/hr/employee-form";
import { HrStatsCards } from "@/components/hr/hr-stats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getHrStats, listContracts, listEmployees } from "@/lib/api/hr-client";
import { formatJalaliDate, formatMoneyRial } from "@/lib/fa-format";
import {
  EMPLOYEE_STATUS_LABELS,
  type Employee,
  type EmploymentContract,
  type HrStats,
} from "@/types/hr";

export default function SuiteHrPage() {
  return (
    <Suspense fallback={null}>
      <HrPage />
    </Suspense>
  );
}

function HrPage() {
  const searchParams = useSearchParams();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [contracts, setContracts] = useState<EmploymentContract[]>([]);
  const [stats, setStats] = useState<HrStats | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listEmployees({ limit: 100, search: search || undefined }, controller.signal),
      listContracts(undefined, controller.signal),
      getHrStats(controller.signal),
    ])
      .then(([emp, con, st]) => {
        setEmployees(emp.data);
        setContracts(con);
        setStats(st);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [search, refreshKey]);

  const isEmpty = !loading && !error && employees.length === 0 && !search;

  return (
    <EnterpriseRouteGuard requireAdmin>
      <PageHeader
        title="کارکنان (HR)"
        description="پرونده کارکنان و قراردادهای حقوقی"
        icon={<UsersRound className="size-6 text-indigo-500" />}
        actions={
          <Button onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>
            <Plus />
            کارمند جدید
          </Button>
        }
      />

      <ErrorNotice title="خطا در دریافت اطلاعات منابع انسانی" message={error} />

      <HrStatsCards stats={stats} />

      {showForm && (
        <EmployeeForm
          onCreated={() => {
            setShowForm(false);
            refresh();
          }}
        />
      )}

      {editing && (
        <EmployeeEditPanel
          employee={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {isEmpty ? (
        <EmptyImportState
          title="فهرست پرسنل قبلی‌تان را اینجا رها کنید"
          hint="فایل اکسل کارکنان را در صفحه ورود داده بارگذاری کنید"
        />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="جست‌وجو در نام، کد پرسنلی یا کد ملی"
                className="pr-8"
                aria-label="جست‌وجوی کارکنان"
              />
            </div>
            <LoadingLine show={loading} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>فهرست کارکنان</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>کد</TableHead>
                  <TableHead>نام</TableHead>
                  <TableHead>سمت</TableHead>
                  <TableHead>واحد</TableHead>
                  <TableHead>موبایل</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead>تاریخ استخدام</TableHead>
                  <TableHead>
                    <span className="sr-only">ویرایش</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      {loading ? "در حال بارگذاری..." : "موردی یافت نشد."}
                    </TableCell>
                  </TableRow>
                )}
                {employees.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.employeeNumber}</TableCell>
                    <TableCell className="font-medium">{e.fullName}</TableCell>
                    <TableCell>{e.jobTitle}</TableCell>
                    <TableCell>{e.department}</TableCell>
                    <TableCell dir="ltr" className="text-right font-mono text-xs">
                      {e.mobile}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{EMPLOYEE_STATUS_LABELS[e.status]}</Badge>
                    </TableCell>
                    <TableCell>{formatJalaliDate(e.hireDate)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`ویرایش ${e.fullName}`}
                        onClick={() => setEditing(e)}
                      >
                        <Pencil />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>قراردادها و احکام حقوقی</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>شماره</TableHead>
                  <TableHead>کارمند</TableHead>
                  <TableHead>سمت</TableHead>
                  <TableHead>شروع</TableHead>
                  <TableHead>پایان</TableHead>
                  <TableHead>حقوق پایه</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      هنوز قراردادی ثبت نشده است.
                    </TableCell>
                  </TableRow>
                )}
                {contracts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.contractNumber}</TableCell>
                    <TableCell className="font-medium">{c.employeeFullName}</TableCell>
                    <TableCell>{c.jobTitle}</TableCell>
                    <TableCell>{formatJalaliDate(c.startDate)}</TableCell>
                    <TableCell>{formatJalaliDate(c.endDate)}</TableCell>
                    <TableCell>{formatMoneyRial(c.baseSalary)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </EnterpriseRouteGuard>
  );
}
