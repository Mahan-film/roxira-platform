"use client";

import { useEffect, useState } from "react";
import { LineChart } from "lucide-react";

import { ErrorNotice, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getProfitability } from "@/lib/api/contracting-client";
import type { ProfitabilityRow } from "@/types/contracting";

export default function ProfitabilityPage() {
  const [rows, setRows] = useState<ProfitabilityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getProfitability(controller.signal)
      .then((r) => setRows(r.projects))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  return (
    <EnterpriseRouteGuard>
      <PageHeader title="سودآوری پروژه‌ها" description="بودجه در برابر هزینه واقعی و مبلغ صورت‌حساب‌شده" icon={<LineChart className="size-6 text-indigo-500" />} />
      <ErrorNotice title="بارگذاری نشد" message={error} />
      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>پروژه</TableHead><TableHead>بودجه</TableHead><TableHead>هزینه پیمانکاران</TableHead><TableHead>هزینه دفتر کل</TableHead>
                <TableHead>هزینه واقعی</TableHead><TableHead>باقی‌مانده بودجه</TableHead><TableHead>صورت‌حساب‌شده</TableHead><TableHead>حاشیه سود</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows?.length === 0 && <TableRow><TableCell colSpan={8} className="text-muted-foreground">پروژه‌ای ثبت نشده است.</TableCell></TableRow>}
              {rows?.map((r) => (
                <TableRow key={r.projectId}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell><Money value={r.budget} /></TableCell>
                  <TableCell><Money value={r.actual.subcontracts} /></TableCell>
                  <TableCell>{r.ledgerLinked && r.actual.ledger !== null ? <Money value={r.actual.ledger} /> : <span className="text-muted-foreground">مرکز هزینه تعریف نشده</span>}</TableCell>
                  <TableCell><Money value={r.actual.total} /></TableCell>
                  <TableCell><Money value={r.budgetRemaining} /></TableCell>
                  <TableCell><Money value={r.billed} /></TableCell>
                  <TableCell><Money value={r.margin} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </EnterpriseRouteGuard>
  );
}
