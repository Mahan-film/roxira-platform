"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";

import { ErrorNotice, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addPettyCashExpense,
  chargePettyCash,
  closePettyCashFund,
  createPettyCashFund,
  getPettyCashStatement,
  listPettyCashFunds,
  returnPettyCash,
  settlePettyCash,
  voidPettyCashExpense,
} from "@/lib/api/accounting-reports-client";
import { formatJalaliDate, formatReportMoney } from "@/lib/fa-format";
import { lastSettlementDate } from "@/lib/petty-cash-ui";
import type { PettyCashFund, PettyCashStatement, PettyCashTransaction } from "@/types/accounting-reports";

const KIND_LABELS: Record<PettyCashTransaction["kind"], string> = {
  CHARGE: "شارژ",
  RETURN: "برگشت وجه",
  EXPENSE: "رسید هزینه",
};

const STATUS_LABELS: Record<PettyCashTransaction["status"], string> = {
  PENDING: "در انتظار تسویه",
  SETTLED: "تسویه‌شده",
  POSTED: "ثبت‌شده",
  VOID: "باطل",
};

const today = () => new Date().toISOString().slice(0, 10);

interface SettlementCell {
  date: string | null;
  error: boolean;
}

export default function PettyCashPage() {
  const [funds, setFunds] = useState<PettyCashFund[]>([]);
  const [settlements, setSettlements] = useState<Record<number, SettlementCell>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statement, setStatement] = useState<PettyCashStatement | null>(null);
  const [newFund, setNewFund] = useState({ name: "", custodianName: "", imprestAmount: "" });
  const [movement, setMovement] = useState({ amount: "", date: today(), accountCode: "1012" });
  const [expense, setExpense] = useState({ amount: "", date: today(), accountCode: "5030", description: "", receiptNumber: "" });
  const [selected, setSelected] = useState<number[]>([]);
  const [settlement, setSettlement] = useState({ date: today(), replenish: "1012" });
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ignoreAbort = (err: unknown) => {
    if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
  };

  const loadSettlements = (list: PettyCashFund[], signal: AbortSignal) => {
    void Promise.allSettled(list.map((fund) => getPettyCashStatement(fund.id, signal))).then((results) => {
      const next: Record<number, SettlementCell> = {};
      results.forEach((result, index) => {
        const fundId = list[index].id;
        next[fundId] =
          result.status === "fulfilled"
            ? { date: lastSettlementDate(result.value.transactions), error: false }
            : { date: null, error: true };
      });
      setSettlements(next);
    });
  };

  useEffect(() => {
    const controller = new AbortController();
    listPettyCashFunds(controller.signal)
      .then((list) => {
        setFunds(list);
        loadSettlements(list, controller.signal);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
      })
      .catch(ignoreAbort);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    getPettyCashStatement(selectedId, controller.signal)
      .then((result) => {
        setStatement(result);
        setSelected([]);
      })
      .catch(ignoreAbort);
    return () => controller.abort();
  }, [selectedId]);

  const reload = async (fundId: number | null) => {
    const list = await listPettyCashFunds();
    setFunds(list);
    loadSettlements(list, new AbortController().signal);
    const id = fundId ?? list[0]?.id ?? null;
    setSelectedId(id);
    if (id !== null) {
      setStatement(await getPettyCashStatement(id));
      setSelected([]);
    }
  };

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload(selectedId);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const fund = statement?.fund;
  const active = fund?.status === "ACTIVE";
  const pending = statement?.transactions.filter((row) => row.status === "PENDING") ?? [];
  const validMovement = movement.amount.trim() && movement.date && movement.accountCode.trim();

  const settlementCell = (row: PettyCashFund): string => {
    const cell = settlements[row.id];
    if (!cell) return "…";
    if (cell.error) return "خطا در بارگذاری";
    if (cell.date === null) return "ثبت نشده";
    return formatJalaliDate(cell.date);
  };

  return (
    <EnterpriseRouteGuard requireAdmin>
      <PageHeader
        title="صندوق و تنخواه"
        description="تنخواه‌گردان‌ها، رسید هزینه‌ها و تسویه با دفتر"
        icon={<Wallet className="size-6 text-indigo-500" />}
      />
      <ErrorNotice title="انجام نشد" message={error} />

      <Card>
        <CardHeader>
          <CardTitle>تنخواه‌ها</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="fund-name">نام</Label>
              <Input id="fund-name" value={newFund.name} onChange={(e) => setNewFund({ ...newFund, name: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fund-custodian">مسئول تنخواه</Label>
              <Input id="fund-custodian" value={newFund.custodianName} onChange={(e) => setNewFund({ ...newFund, custodianName: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fund-imprest">سقف (ریال)</Label>
              <Input id="fund-imprest" dir="ltr" inputMode="decimal" value={newFund.imprestAmount} onChange={(e) => setNewFund({ ...newFund, imprestAmount: e.target.value })} />
            </div>
            <Button
              disabled={busy || !newFund.name.trim() || !newFund.custodianName.trim() || !newFund.imprestAmount.trim()}
              onClick={() =>
                run(async () => {
                  await createPettyCashFund({ ...newFund, imprestAmount: newFund.imprestAmount.trim() });
                  setNewFund({ name: "", custodianName: "", imprestAmount: "" });
                })
              }
            >
              + تعریف تنخواه
            </Button>
          </div>

          {funds.length > 0 && (
            <>
              <div className="grid gap-3 sm:hidden">
                {funds.map((row) => (
                  <div key={row.id} className="grid gap-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{row.name}</span>
                      {row.id === selectedId && <Badge variant="outline">انتخاب‌شده</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">مسئول: {row.custodianName}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <span className="text-muted-foreground">سقف تنخواه</span>
                      <span className="text-end tabular-nums">{formatReportMoney(row.imprestAmount)}</span>
                      <span className="text-muted-foreground">موجودی</span>
                      <span className="text-end tabular-nums">{formatReportMoney(row.balance)}</span>
                      <span className="text-muted-foreground">قابل استفاده</span>
                      <span className="text-end tabular-nums">{formatReportMoney(row.available)}</span>
                      <span className="text-muted-foreground">آخرین تسویه</span>
                      <span className="text-end">{settlementCell(row)}</span>
                    </div>
                    <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setSelectedId(row.id)}>
                      صورت تنخواه
                    </Button>
                  </div>
                ))}
              </div>

              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>تنخواه</TableHead>
                      <TableHead>مسئول</TableHead>
                      <TableHead className="text-end">سقف تنخواه</TableHead>
                      <TableHead className="text-end">موجودی</TableHead>
                      <TableHead className="text-end">قابل استفاده</TableHead>
                      <TableHead>آخرین تسویه</TableHead>
                      <TableHead className="text-end">عملیات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {funds.map((row) => (
                      <TableRow key={row.id} data-state={row.id === selectedId ? "selected" : undefined}>
                        <TableCell>{row.name}</TableCell>
                        <TableCell>{row.custodianName}</TableCell>
                        <TableCell className="text-end tabular-nums">{formatReportMoney(row.imprestAmount)}</TableCell>
                        <TableCell className="text-end tabular-nums">{formatReportMoney(row.balance)}</TableCell>
                        <TableCell className="text-end tabular-nums">{formatReportMoney(row.available)}</TableCell>
                        <TableCell className="whitespace-nowrap">{settlementCell(row)}</TableCell>
                        <TableCell className="text-end">
                          <Button variant="ghost" size="sm" onClick={() => setSelectedId(row.id)}>
                            صورت تنخواه
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {funds.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center">
              <p className="text-sm font-medium">هنوز تنخواهی ثبت نشده است</p>
              <p className="mt-1 text-sm text-muted-foreground">
                تنخواه‌گردان، مبلغ سقف و مسئول آن را ثبت کنید. هزینه‌های نقدی با رسید به تنخواه ثبت و با تسویه به دفتر منتقل می‌شوند.
              </p>
              <Button className="mt-3" onClick={() => document.getElementById("fund-name")?.focus()}>
                + تعریف تنخواه
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {fund && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-3">
              <span>
                صورت تنخواه {fund.name}
                {!active && <Badge variant="outline" className="ms-2">بسته</Badge>}
              </span>
              <span className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!active || busy} onClick={() => setExpenseOpen(true)}>
                  + هزینه تنخواه
                </Button>
                <Button size="sm" variant="outline" disabled={!active || busy} onClick={() => setSettleOpen(true)}>
                  تسویه تنخواه
                </Button>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            {active && (
              <section aria-label="شارژ یا برگشت وجه" className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="move-amount">مبلغ (ریال)</Label>
                  <Input id="move-amount" dir="ltr" inputMode="decimal" value={movement.amount} onChange={(e) => setMovement({ ...movement, amount: e.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="move-date">تاریخ</Label>
                  <JalaliDateInput id="move-date" value={movement.date} onChange={(date) => setMovement({ ...movement, date })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="move-account">حساب بانک یا صندوق</Label>
                  <Input id="move-account" dir="ltr" className="w-28" value={movement.accountCode} onChange={(e) => setMovement({ ...movement, accountCode: e.target.value })} />
                </div>
                <Button
                  variant="outline"
                  disabled={busy || !validMovement}
                  onClick={() =>
                    run(async () => {
                      await chargePettyCash(fund.id, { ...movement, amount: movement.amount.trim() });
                      setMovement({ ...movement, amount: "" });
                    })
                  }
                >
                  شارژ
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !validMovement}
                  onClick={() =>
                    run(async () => {
                      await returnPettyCash(fund.id, { ...movement, amount: movement.amount.trim() });
                      setMovement({ ...movement, amount: "" });
                    })
                  }
                >
                  برگشت وجه
                </Button>
              </section>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead />
                    <TableHead>تاریخ</TableHead>
                    <TableHead>نوع</TableHead>
                    <TableHead>حساب</TableHead>
                    <TableHead>شرح</TableHead>
                    <TableHead>وضعیت</TableHead>
                    <TableHead className="text-end">مبلغ</TableHead>
                    <TableHead className="text-end" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.transactions.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        {row.status === "PENDING" && (
                          <input
                            type="checkbox"
                            aria-label={`انتخاب رسید ${row.description}`}
                            checked={selected.includes(row.id)}
                            onChange={(e) =>
                              setSelected(e.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))
                            }
                          />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatJalaliDate(row.date)}</TableCell>
                      <TableCell>{KIND_LABELS[row.kind]}</TableCell>
                      <TableCell>{row.accountCode}</TableCell>
                      <TableCell className="min-w-40 whitespace-normal">{row.description}</TableCell>
                      <TableCell>{STATUS_LABELS[row.status]}</TableCell>
                      <TableCell className="text-end tabular-nums">{formatReportMoney(row.amount)}</TableCell>
                      <TableCell className="text-end">
                        {row.status === "PENDING" && (
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => voidPettyCashExpense(fund.id, row.id))}>
                            ابطال
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {fund && (
        <Drawer
          open={expenseOpen}
          title="هزینه تنخواه"
          description={`ثبت رسید هزینه برای ${fund.name}`}
          onClose={() => setExpenseOpen(false)}
        >
          {active && (
            <section aria-label="رسید هزینه" className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1">
                <Label htmlFor="exp-amount">مبلغ رسید</Label>
                <Input id="exp-amount" dir="ltr" inputMode="decimal" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="exp-date">تاریخ</Label>
                <JalaliDateInput id="exp-date" value={expense.date} onChange={(date) => setExpense({ ...expense, date })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="exp-account">حساب هزینه</Label>
                <Input id="exp-account" dir="ltr" className="w-28" value={expense.accountCode} onChange={(e) => setExpense({ ...expense, accountCode: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="exp-description">شرح</Label>
                <Input id="exp-description" value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="exp-receipt">شماره رسید</Label>
                <Input id="exp-receipt" dir="ltr" className="w-28" value={expense.receiptNumber} onChange={(e) => setExpense({ ...expense, receiptNumber: e.target.value })} />
              </div>
              <Button
                disabled={busy || !expense.amount.trim() || !expense.date || !expense.description.trim()}
                onClick={() =>
                  run(async () => {
                    await addPettyCashExpense(fund.id, {
                      ...expense,
                      amount: expense.amount.trim(),
                      receiptNumber: expense.receiptNumber.trim() || undefined,
                    });
                    setExpense({ ...expense, amount: "", description: "", receiptNumber: "" });
                    setExpenseOpen(false);
                  })
                }
              >
                ثبت رسید
              </Button>
            </section>
          )}
        </Drawer>
      )}

      {fund && (
        <Drawer
          open={settleOpen}
          title="تسویه تنخواه"
          description={`تسویه رسیدهای ${fund.name} در دفتر`}
          onClose={() => setSettleOpen(false)}
        >
          {active && (
            <section aria-label="تسویه" className="flex flex-wrap items-end gap-3">
              <Button variant="ghost" size="sm" disabled={pending.length === 0} onClick={() => setSelected(pending.map((row) => row.id))}>
                انتخاب همه رسیدها
              </Button>
              <div className="grid gap-1">
                <Label htmlFor="settle-date">تاریخ تسویه</Label>
                <JalaliDateInput id="settle-date" value={settlement.date} onChange={(date) => setSettlement({ ...settlement, date })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="settle-account">جبران از حساب (اختیاری)</Label>
                <Input id="settle-account" dir="ltr" className="w-28" value={settlement.replenish} onChange={(e) => setSettlement({ ...settlement, replenish: e.target.value })} />
              </div>
              <Button
                disabled={busy || selected.length === 0 || !settlement.date}
                onClick={() =>
                  run(() =>
                    settlePettyCash(fund.id, {
                      expenseIds: selected,
                      date: settlement.date,
                      replenishFromAccountCode: settlement.replenish.trim() || undefined,
                    }),
                  )
                }
              >
                تسویه {selected.length > 0 ? `${selected.length} رسید` : ""}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => run(() => closePettyCashFund(fund.id))}>
                بستن تنخواه
              </Button>
            </section>
          )}
        </Drawer>
      )}
    </EnterpriseRouteGuard>
  );
}
