"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw, Wallet } from "lucide-react";

import { ErrorNotice, LoadingLine, loadErrorMessage } from "@/components/app/app-ui";
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
  createPettyCashFund,
  getPettyCashStatement,
  listPettyCashFunds,
  returnPettyCash,
  settlePettyCash,
  voidPettyCashExpense,
} from "@/lib/api/accounting-reports-client";
import { formatJalaliDate, formatReportMoney } from "@/lib/fa-format";
import { lastSettlementDate, normalizeAmount } from "@/lib/petty-cash-ui";
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

export function PettyCashView() {
  const [funds, setFunds] = useState<PettyCashFund[]>([]);
  const [settlements, setSettlements] = useState<Record<number, SettlementCell>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statement, setStatement] = useState<PettyCashStatement | null>(null);
  const [newFund, setNewFund] = useState({ name: "", custodianName: "", imprestAmount: "" });
  const [movement, setMovement] = useState({ amount: "", date: today(), accountCode: "" });
  const [expense, setExpense] = useState({ amount: "", date: today(), accountCode: "", description: "", receiptNumber: "" });
  const [settlement, setSettlement] = useState({ date: today(), replenish: "" });
  const [newFundOpen, setNewFundOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
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
  const validMovement = normalizeAmount(movement.amount) !== null && movement.date && movement.accountCode.trim();

  const settlementCell = (row: PettyCashFund): string => {
    const cell = settlements[row.id];
    if (!cell) return "…";
    if (cell.error) return "خطا در بارگذاری";
    if (cell.date === null) return "ثبت نشده";
    return formatJalaliDate(cell.date);
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="size-5 text-indigo-600" />
          <h2 className="text-base font-semibold">تنخواه‌گردان‌ها و هزینه‌ها</h2>
          <Badge variant="secondary" className="font-mono text-xs">
            {funds.length} صندوق تنخواه
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setNewFundOpen(true)}>
            <Plus className="size-4 ml-1.5" />
            تنخواه جدید
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void reload(selectedId)}>
            <RefreshCw className="size-4 ml-1.5" />
            تازه‌سازی
          </Button>
        </div>
      </div>

      {error && <ErrorNotice title="خطا در عملیات تنخواه" message={error} />}
      <LoadingLine show={busy} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Funds List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium">صندوق‌های تنخواه‌گردان</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {funds.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                هنوز تنخواهی تعریف نشده است.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {funds.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedId(f.id)}
                    className={`w-full p-4 text-right transition-colors hover:bg-muted/50 ${
                      selectedId === f.id ? "bg-muted font-semibold" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm">{f.name}</span>
                      <Badge variant={f.status === "ACTIVE" ? "default" : "secondary"}>
                        {f.status === "ACTIVE" ? "فعال" : "بسته‌شده"}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>تنخواه‌دار: {f.custodianName}</span>
                      <span className="font-mono">{formatReportMoney(f.imprestAmount)}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      آخرین تسویه: {settlementCell(f)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Selected Fund Details & Statement */}
        <div className="space-y-6 lg:col-span-2">
          {fund ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{fund.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        تنخواه‌دار: {fund.custodianName} | سقف تنخواه: {formatReportMoney(fund.imprestAmount)}
                      </p>
                    </div>
                    {active && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setChargeOpen(true)}>
                          شارژ تنخواه
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setReturnOpen(true)}>
                          برگشت وجه
                        </Button>
                        <Button size="sm" onClick={() => setExpenseOpen(true)}>
                          ثبت رسید هزینه
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setSettleOpen(true)}
                          disabled={pending.length === 0}
                        >
                          تسویه ({pending.length})
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/40 p-4 sm:grid-cols-3">
                    <div>
                      <span className="text-xs text-muted-foreground">موجودی نقدی:</span>
                      <p className="font-mono text-base font-bold text-emerald-600">
                        {formatReportMoney(statement?.currentBalance ?? 0)}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">رسیدهای در انتظار تسویه:</span>
                      <p className="font-mono text-base font-bold text-amber-600">
                        {formatReportMoney(
                          pending.reduce((sum, r) => sum + Number(r.amount), 0)
                        )}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">تعداد اسناد باز:</span>
                      <p className="font-mono text-base font-bold">{pending.length}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Transactions Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">گردش عملیات تنخواه</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-28 text-right">تاریخ</TableHead>
                          <TableHead className="w-24 text-center">نوع</TableHead>
                          <TableHead className="w-24 text-center">شماره رسید</TableHead>
                          <TableHead className="text-right">شرح</TableHead>
                          <TableHead className="w-32 text-left font-mono">مبلغ (ریال)</TableHead>
                          <TableHead className="w-28 text-center">وضعیت</TableHead>
                          <TableHead className="w-20 text-center">عملیات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(statement?.transactions ?? []).length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                              هنوز تراکنشی برای این تنخواه ثبت نشده است.
                            </TableCell>
                          </TableRow>
                        ) : (
                          statement?.transactions.map((tx) => (
                            <TableRow key={tx.id}>
                              <TableCell className="font-mono text-xs">{formatJalaliDate(tx.date)}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant="outline">{KIND_LABELS[tx.kind] ?? tx.kind}</Badge>
                              </TableCell>
                              <TableCell className="text-center font-mono text-xs">{tx.receiptNumber || "—"}</TableCell>
                              <TableCell className="text-sm">{tx.description || "—"}</TableCell>
                              <TableCell className="text-left font-mono font-medium">
                                {formatReportMoney(tx.amount)}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge
                                  variant={
                                    tx.status === "SETTLED" || tx.status === "POSTED"
                                      ? "default"
                                      : tx.status === "PENDING"
                                      ? "secondary"
                                      : "destructive"
                                  }
                                >
                                  {STATUS_LABELS[tx.status] ?? tx.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center">
                                {tx.kind === "EXPENSE" && tx.status === "PENDING" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs text-rose-600 hover:text-rose-700"
                                    onClick={() => void run(() => voidPettyCashExpense(fund.id, tx.id))}
                                  >
                                    ابطال
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                یک تنخواه‌گردان را از ستون کناری انتخاب کنید.
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Drawer: Create Fund */}
      <Drawer open={newFundOpen} onClose={() => setNewFundOpen(false)} title="ایجاد صندوق تنخواه‌گردان جدید" size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const imprest = normalizeAmount(newFund.imprestAmount);
            if (!newFund.name.trim() || !newFund.custodianName.trim() || imprest === null) {
              setError("لطفاً نام تنخواه، نام تنخواه‌دار و مبلغ سقف را به درستی وارد کنید.");
              return;
            }
            setNewFundOpen(false);
            void run(() =>
              createPettyCashFund({
                name: newFund.name.trim(),
                custodianName: newFund.custodianName.trim(),
                imprestAmount: imprest,
              })
            );
          }}
          className="space-y-4 py-2"
        >
          <div>
            <Label htmlFor="fund-name">عنوان تنخواه</Label>
            <Input
              id="fund-name"
              value={newFund.name}
              onChange={(e) => setNewFund({ ...newFund, name: e.target.value })}
              placeholder="تنخواه خرید ملزومات اداری"
              required
            />
          </div>
          <div>
            <Label htmlFor="fund-custodian">نام تنخواه‌دار (مسئول)</Label>
            <Input
              id="fund-custodian"
              value={newFund.custodianName}
              onChange={(e) => setNewFund({ ...newFund, custodianName: e.target.value })}
              placeholder="علی رضایی"
              required
            />
          </div>
          <div>
            <Label htmlFor="fund-imprest">سقف مبلغ تنخواه (ریال)</Label>
            <Input
              id="fund-imprest"
              type="number"
              value={newFund.imprestAmount}
              onChange={(e) => setNewFund({ ...newFund, imprestAmount: e.target.value })}
              placeholder="50000000"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={() => setNewFundOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={busy}>
              ایجاد تنخواه
            </Button>
          </div>
        </form>
      </Drawer>

      {/* Drawer: Charge Fund */}
      <Drawer open={chargeOpen} onClose={() => setChargeOpen(false)} title="شارژ تنخواه از حساب بانکی" size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!fund || !validMovement) {
              setError("لطفاً مبلغ، تاریخ و کد حساب بانکی را وارد کنید.");
              return;
            }
            setChargeOpen(false);
            void run(() =>
              chargePettyCash(fund.id, {
                amount: normalizeAmount(movement.amount) ?? "0",
                date: movement.date,
                bankAccountCode: movement.accountCode.trim(),
              })
            );
          }}
          className="space-y-4 py-2"
        >
          <div>
            <Label htmlFor="charge-amount">مبلغ شارژ (ریال)</Label>
            <Input
              id="charge-amount"
              type="number"
              value={movement.amount}
              onChange={(e) => setMovement({ ...movement, amount: e.target.value })}
              placeholder="20000000"
              required
            />
          </div>
          <div>
            <Label htmlFor="charge-date">تاریخ واریز</Label>
            <JalaliDateInput
              id="charge-date"
              value={movement.date}
              onChange={(val) => setMovement({ ...movement, date: val || today() })}
            />
          </div>
          <div>
            <Label htmlFor="charge-account">کد حساب بانکی مبدا</Label>
            <Input
              id="charge-account"
              value={movement.accountCode}
              onChange={(e) => setMovement({ ...movement, accountCode: e.target.value })}
              placeholder="1021"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={() => setChargeOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={busy}>
              ثبت شارژ
            </Button>
          </div>
        </form>
      </Drawer>

      {/* Drawer: Return Fund */}
      <Drawer open={returnOpen} onClose={() => setReturnOpen(false)} title="برگشت وجه به حساب بانکی" size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!fund || !validMovement) {
              setError("لطفاً مبلغ، تاریخ و کد حساب بانکی را وارد کنید.");
              return;
            }
            setReturnOpen(false);
            void run(() =>
              returnPettyCash(fund.id, {
                amount: normalizeAmount(movement.amount) ?? "0",
                date: movement.date,
                bankAccountCode: movement.accountCode.trim(),
              })
            );
          }}
          className="space-y-4 py-2"
        >
          <div>
            <Label htmlFor="return-amount">مبلغ برگشتی (ریال)</Label>
            <Input
              id="return-amount"
              type="number"
              value={movement.amount}
              onChange={(e) => setMovement({ ...movement, amount: e.target.value })}
              placeholder="5000000"
              required
            />
          </div>
          <div>
            <Label htmlFor="return-date">تاریخ برگشت</Label>
            <JalaliDateInput
              id="return-date"
              value={movement.date}
              onChange={(val) => setMovement({ ...movement, date: val || today() })}
            />
          </div>
          <div>
            <Label htmlFor="return-account">کد حساب بانکی مقصد</Label>
            <Input
              id="return-account"
              value={movement.accountCode}
              onChange={(e) => setMovement({ ...movement, accountCode: e.target.value })}
              placeholder="1021"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={() => setReturnOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={busy}>
              ثبت برگشت وجه
            </Button>
          </div>
        </form>
      </Drawer>

      {/* Drawer: Record Expense */}
      <Drawer open={expenseOpen} onClose={() => setExpenseOpen(false)} title="ثبت رسید هزینه جدید" size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const amt = normalizeAmount(expense.amount);
            if (!fund || amt === null || !expense.date || !expense.accountCode.trim()) {
              setError("لطفاً مبلغ، تاریخ و کد حساب معین هزینه را تکمیل کنید.");
              return;
            }
            setExpenseOpen(false);
            void run(() =>
              addPettyCashExpense(fund.id, {
                amount: amt,
                date: expense.date,
                expenseAccountCode: expense.accountCode.trim(),
                description: expense.description.trim() || undefined,
                receiptNumber: expense.receiptNumber.trim() || undefined,
              })
            );
          }}
          className="space-y-4 py-2"
        >
          <div>
            <Label htmlFor="exp-amount">مبلغ هزینه (ریال)</Label>
            <Input
              id="exp-amount"
              type="number"
              value={expense.amount}
              onChange={(e) => setExpense({ ...expense, amount: e.target.value })}
              placeholder="1500000"
              required
            />
          </div>
          <div>
            <Label htmlFor="exp-date">تاریخ فاکتور / رسید</Label>
            <JalaliDateInput
              id="exp-date"
              value={expense.date}
              onChange={(val) => setExpense({ ...expense, date: val || today() })}
            />
          </div>
          <div>
            <Label htmlFor="exp-account">کد معین حساب هزینه</Label>
            <Input
              id="exp-account"
              value={expense.accountCode}
              onChange={(e) => setExpense({ ...expense, accountCode: e.target.value })}
              placeholder="7011"
              required
            />
          </div>
          <div>
            <Label htmlFor="exp-receipt">شماره فاکتور / رسید</Label>
            <Input
              id="exp-receipt"
              value={expense.receiptNumber}
              onChange={(e) => setExpense({ ...expense, receiptNumber: e.target.value })}
              placeholder="INV-9901"
            />
          </div>
          <div>
            <Label htmlFor="exp-desc">شرح هزینه</Label>
            <Input
              id="exp-desc"
              value={expense.description}
              onChange={(e) => setExpense({ ...expense, description: e.target.value })}
              placeholder="خرید لوازم‌التحریر و پذیرایی"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={() => setExpenseOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={busy}>
              ثبت هزینه
            </Button>
          </div>
        </form>
      </Drawer>

      {/* Drawer: Settle Petty Cash */}
      <Drawer open={settleOpen} onClose={() => setSettleOpen(false)} title="تسویه دوره‌ای تنخواه‌گردان با دفتر کل" size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!fund || pending.length === 0) return;
            setSettleOpen(false);
            void run(() =>
              settlePettyCash(fund.id, {
                date: settlement.date,
                transactionIds: pending.map((tx) => tx.id),
                replenish: settlement.replenish === "true",
              })
            );
          }}
          className="space-y-4 py-2"
        >
          <p className="text-sm text-muted-foreground">
            تعداد {pending.length} سند هزینه به ارزش کل{" "}
            <span className="font-mono font-bold text-foreground">
              {formatReportMoney(pending.reduce((sum, r) => sum + Number(r.amount), 0))}
            </span>{" "}
            تسویه شده و سند حسابداری صادر خواهد شد.
          </p>
          <div>
            <Label htmlFor="settle-date">تاریخ تسویه</Label>
            <JalaliDateInput
              id="settle-date"
              value={settlement.date}
              onChange={(val) => setSettlement({ ...settlement, date: val || today() })}
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="settle-replenish"
              checked={settlement.replenish === "true"}
              onChange={(e) => setSettlement({ ...settlement, replenish: e.target.checked ? "true" : "false" })}
              className="size-4 rounded border-input"
            />
            <Label htmlFor="settle-replenish" className="cursor-pointer text-sm">
              شارژ مجدد خودکار تنخواه پس از تسویه
            </Label>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={() => setSettleOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={busy}>
              تأیید و صدور سند تسویه
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
