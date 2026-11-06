"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ErrorNotice, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { MoneyInput } from "@/components/ui/money-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  activateContract, approveStatement, createAdvance, createStatement, getContract, listMovements, listStatements, postStatement, releaseRetention,
} from "@/lib/api/contracting-client";
import { CONTRACT_STATUS_LABEL, STATEMENT_STATUS_LABEL, nextAction, rateAsPercent, termProvenance } from "@/lib/contracting-ui";
import { formatJalaliDate } from "@/lib/fa-format";
import type { Contract, Movement, Statement } from "@/types/contracting";

const key = () => crypto.randomUUID().replace(/-/g, "");

export default function ContractDetailPage() {
  const id = Number(useParams<{ id: string }>().id);
  const [contract, setContract] = useState<Contract | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stmt, setStmt] = useState({ date: "", cumulative: "" });
  const [advance, setAdvance] = useState({ date: "", amount: "" });
  const [release, setRelease] = useState({ date: "", amount: "" });

  const [tick, setTick] = useState(0);
  const reload = () => { setTick((t) => t + 1); return Promise.resolve(); };

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getContract(id, controller.signal), listStatements(id, controller.signal), listMovements(id, controller.signal)])
      .then(([c, s, m]) => {
        setContract(c);
        setStatements(s);
        setMovements(m);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, [id, tick]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(loadErrorMessage(err));
    }
  }

  const active = contract?.status === "active";
  const usedTerms = statements.flatMap((s) => (s.status === "draft" ? [] : s.termsUsed.map((t) => ({ ...t, statement: s.number }))));

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title={contract ? `${contract.code} — ${contract.title}` : "قرارداد"}
        description={contract ? `${contract.side === "contractor" ? "ما پیمانکاریم" : "ما کارفرماییم"} · ${formatJalaliDate(contract.contractDate)}` : undefined}
        actions={<Link href="/app/contracting" className="text-sm text-primary underline">همه قراردادها</Link>}
      />
      <ErrorNotice title="انجام نشد" message={error} />

      {contract && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-6 pt-4 text-sm">
            <span>مبلغ قرارداد: <Money value={contract.amount} suffix /></span>
            <span>پیش‌پرداخت توافقی: <Money value={contract.advanceAmount} suffix /></span>
            <Badge variant="secondary">{CONTRACT_STATUS_LABEL[contract.status]}</Badge>
            {contract.status === "draft" && <Button onClick={() => void run(() => activateContract(id))}>فعال‌سازی قرارداد</Button>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>صورت وضعیت‌ها</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>شماره</TableHead><TableHead>تاریخ</TableHead><TableHead>مبلغ تجمعی</TableHead><TableHead>این دوره</TableHead>
                <TableHead>حسن انجام کار</TableHead><TableHead>کسور بیمه</TableHead><TableHead>استهلاک پیش‌پرداخت</TableHead><TableHead>خالص</TableHead><TableHead>وضعیت</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {statements.length === 0 && <TableRow><TableCell colSpan={10} className="text-muted-foreground">هنوز صورت وضعیتی ثبت نشده است.</TableCell></TableRow>}
              {statements.map((s) => {
                const action = nextAction(s.status);
                return (
                  <TableRow key={s.id}>
                    <TableCell>{s.number}</TableCell>
                    <TableCell>{formatJalaliDate(s.statementDate)}</TableCell>
                    <TableCell><Money value={s.cumulativeAmount} /></TableCell>
                    <TableCell><Money value={s.periodAmount} /></TableCell>
                    <TableCell><Money value={s.retentionAmount} /></TableCell>
                    <TableCell><Money value={s.insuranceAmount} /></TableCell>
                    <TableCell><Money value={s.advanceRecoveryAmount} /></TableCell>
                    <TableCell><Money value={s.netPayable} /></TableCell>
                    <TableCell>{STATEMENT_STATUS_LABEL[s.status]}{s.journalEntryNumber ? ` · ${s.journalEntryNumber}` : ""}</TableCell>
                    <TableCell>
                      {action === "approve" && <Button size="sm" onClick={() => void run(() => approveStatement(s.id))}>تأیید</Button>}
                      {action === "post" && <Button size="sm" onClick={() => void run(() => postStatement(s.id))}>ثبت سند</Button>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {usedTerms.length > 0 && (
            <div className="rounded-md border p-3 text-sm">
              <p className="mb-2 font-medium">مبنای محاسبه کسورات</p>
              <ul className="grid gap-1">
                {usedTerms.map((t) => (
                  <li key={`${t.statement}-${t.key}`}>
                    صورت وضعیت {t.statement}: {t.label} — {rateAsPercent(t.rate)} <span className="text-muted-foreground">({termProvenance(t)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await createStatement(id, { statementDate: stmt.date, cumulativeAmount: stmt.cumulative });
                setStmt({ date: "", cumulative: "" });
              });
            }}
          >
            <div className="grid gap-1"><Label htmlFor="s-date">تاریخ</Label><JalaliDateInput id="s-date" value={stmt.date} onChange={(date) => setStmt({ ...stmt, date })} /></div>
            <div className="grid gap-1"><Label htmlFor="s-cum">مبلغ تجمعی کارکرد</Label><MoneyInput id="s-cum" value={stmt.cumulative} onChange={(cumulative) => setStmt({ ...stmt, cumulative })} /></div>
            <Button type="submit" disabled={!active || !stmt.date || !stmt.cumulative}>صورت وضعیت جدید</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>پیش‌پرداخت و آزادسازی سپرده</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <Table>
            <TableHeader><TableRow><TableHead>نوع</TableHead><TableHead>تاریخ</TableHead><TableHead>مبلغ</TableHead><TableHead>سند</TableHead></TableRow></TableHeader>
            <TableBody>
              {movements.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">رویدادی ثبت نشده است.</TableCell></TableRow>}
              {movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.kind === "advance" ? "پیش‌پرداخت" : "آزادسازی سپرده"}</TableCell>
                  <TableCell>{formatJalaliDate(m.date)}</TableCell>
                  <TableCell><Money value={m.amount} suffix /></TableCell>
                  <TableCell>{m.journalEntryNumber ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await createAdvance(id, { date: advance.date, amount: advance.amount, requestKey: key() });
                setAdvance({ date: "", amount: "" });
              });
            }}
          >
            <div className="grid gap-1"><Label htmlFor="a-date">تاریخ پیش‌پرداخت</Label><JalaliDateInput id="a-date" value={advance.date} onChange={(date) => setAdvance({ ...advance, date })} /></div>
            <div className="grid gap-1"><Label htmlFor="a-amount">مبلغ پیش‌پرداخت</Label><MoneyInput id="a-amount" value={advance.amount} onChange={(amount) => setAdvance({ ...advance, amount })} /></div>
            <Button type="submit" disabled={!active || !advance.date || !advance.amount}>ثبت پیش‌پرداخت</Button>
          </form>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await releaseRetention(id, { date: release.date, amount: release.amount, requestKey: key() });
                setRelease({ date: "", amount: "" });
              });
            }}
          >
            <div className="grid gap-1"><Label htmlFor="r-date">تاریخ آزادسازی</Label><JalaliDateInput id="r-date" value={release.date} onChange={(date) => setRelease({ ...release, date })} /></div>
            <div className="grid gap-1"><Label htmlFor="r-amount">مبلغ آزادسازی سپرده</Label><MoneyInput id="r-amount" value={release.amount} onChange={(amount) => setRelease({ ...release, amount })} /></div>
            <Button type="submit" disabled={!active || !release.date || !release.amount}>آزادسازی سپرده</Button>
          </form>
        </CardContent>
      </Card>
    </EnterpriseRouteGuard>
  );
}
