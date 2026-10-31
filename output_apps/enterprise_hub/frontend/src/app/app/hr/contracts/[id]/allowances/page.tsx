"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, Trash2, Wallet } from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listContractAllowances, replaceContractAllowances } from "@/lib/api/hr-client";
import type { AllowanceTaxTreatment, ContractAllowance } from "@/types/hr";

const TAX_LABELS: Record<AllowanceTaxTreatment, string> = {
  PROGRESSIVE: "مشمول پلکانی",
  FLAT: "نرخ مقطوع",
  EXEMPT: "معاف",
  NON_CASH: "غیرنقدی (تا سقف معاف)",
};

const EMPTY: ContractAllowance = { title: "", amount: 0, insurable: true, taxTreatment: "PROGRESSIVE" };

export default function ContractAllowancesPage({ params }: { params: Promise<{ id: string }> }) {
  const contractId = Number(use(params).id);
  const [rows, setRows] = useState<ContractAllowance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listContractAllowances(contractId, controller.signal)
      .then(setRows)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setRows([]);
        setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, [contractId]);

  const update = (index: number, patch: Partial<ContractAllowance>) =>
    setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, ...patch } : row)) ?? prev);

  async function save() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      setRows(await replaceContractAllowances(contractId, rows));
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <EnterpriseRouteGuard requireAdmin>
      <PageHeader
        title="مزایای قرارداد"
        description="هر مزیت با مبلغ ماهانه، شمول بیمه و نوع مالیات خودش"
        icon={<Wallet className="size-6 text-indigo-500" />}
        actions={
          <Link href="/app/hr" className={buttonVariants({ variant: "outline" })}>
            <ArrowRight />
            بازگشت به کارکنان
          </Link>
        }
      />
      <ErrorNotice title="عملیات انجام نشد" message={error} />
      <Card>
        <CardHeader>
          <CardTitle>فهرست مزایا</CardTitle>
          <CardDescription>تغییرات از اجرای بعدی حقوق اعمال می‌شود.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {rows === null ? (
            <LoadingLine show />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>عنوان</TableHead>
                  <TableHead>مبلغ (ریال)</TableHead>
                  <TableHead>مشمول بیمه</TableHead>
                  <TableHead>مالیات</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Input
                        aria-label="عنوان"
                        value={row.title}
                        onChange={(event) => update(index, { title: event.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label="مبلغ"
                        type="number"
                        min={0}
                        value={row.amount}
                        onChange={(event) => update(index, { amount: Math.max(0, Number(event.target.value) || 0) })}
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        aria-label="مشمول بیمه"
                        type="checkbox"
                        checked={row.insurable}
                        onChange={(event) => update(index, { insurable: event.target.checked })}
                      />
                    </TableCell>
                    <TableCell>
                      <select
                        aria-label="مالیات"
                        className="rounded-md border bg-transparent px-2 py-1 text-sm"
                        value={row.taxTreatment}
                        onChange={(event) =>
                          update(index, { taxTreatment: event.target.value as AllowanceTaxTreatment })
                        }
                      >
                        {Object.entries(TAX_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label="حذف"
                        onClick={() => setRows((prev) => prev?.filter((_, i) => i !== index) ?? prev)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRows((prev) => [...(prev ?? []), { ...EMPTY }])}>
              <Plus />
              افزودن
            </Button>
            <Button
              onClick={() => void save()}
              disabled={busy || rows === null || rows.some((row) => row.title.trim() === "")}
            >
              ذخیره
            </Button>
          </div>
        </CardContent>
      </Card>
    </EnterpriseRouteGuard>
  );
}
