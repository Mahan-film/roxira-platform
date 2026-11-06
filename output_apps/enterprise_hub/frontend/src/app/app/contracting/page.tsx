"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HardHat } from "lucide-react";

import { ErrorNotice, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { MoneyInput } from "@/components/ui/money-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createContract, createProject, listContracts, listParties, listProjects } from "@/lib/api/contracting-client";
import { CONTRACT_STATUS_LABEL, SIDE_LABEL } from "@/lib/contracting-ui";
import { formatJalaliDate } from "@/lib/fa-format";
import type { Contract, ContractSide, PartyOption, Project } from "@/types/contracting";

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export default function ContractingPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState({ code: "", name: "", costCentreCode: "", budget: "" });
  const [contract, setContract] = useState({ code: "", title: "", side: "contractor" as ContractSide, partyCode: "", projectId: "", contractDate: "", amount: "", advanceAmount: "" });

  const [tick, setTick] = useState(0);
  const reload = () => { setTick((t) => t + 1); return Promise.resolve(); };

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([listProjects(controller.signal), listContracts(controller.signal), listParties(controller.signal)])
      .then(([p, c, pa]) => {
        setProjects(p.data);
        setContracts(c.data);
        setParties(pa.data);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, [tick]);

  const partyName = (code: string) => parties.find((p) => p.code === code)?.name ?? code;
  const fitting = parties.filter((p) => p.role === "both" || p.role === (contract.side === "employer" ? "supplier" : "customer"));

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(loadErrorMessage(err));
    }
  }

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="قراردادها و پروژه‌ها"
        description="قرارداد پیمانکاری، صورت وضعیت، سپرده و پیش‌پرداخت"
        icon={<HardHat className="size-6 text-indigo-500" />}
        actions={<Link href="/app/contracting/profitability" className="text-sm text-primary underline">سودآوری پروژه‌ها</Link>}
      />
      <ErrorNotice title="انجام نشد" message={error} />

      <Card>
        <CardHeader><CardTitle>پروژه‌ها</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <Table>
            <TableHeader><TableRow><TableHead>کد</TableHead><TableHead>نام</TableHead><TableHead>مرکز هزینه</TableHead><TableHead>بودجه</TableHead></TableRow></TableHeader>
            <TableBody>
              {projects.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">هنوز پروژه‌ای ثبت نشده است.</TableCell></TableRow>}
              {projects.map((p) => (
                <TableRow key={p.id}><TableCell>{p.code}</TableCell><TableCell>{p.name}</TableCell><TableCell>{p.costCentreCode ?? "—"}</TableCell><TableCell><Money value={p.budget} suffix /></TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await createProject({ code: project.code, name: project.name, costCentreCode: project.costCentreCode || undefined, budget: project.budget || undefined });
                setProject({ code: "", name: "", costCentreCode: "", budget: "" });
              });
            }}
          >
            <div className="grid gap-1"><Label htmlFor="p-code">کد پروژه</Label><Input id="p-code" className="w-28" value={project.code} onChange={(e) => setProject({ ...project, code: e.target.value })} /></div>
            <div className="grid gap-1"><Label htmlFor="p-name">نام پروژه</Label><Input id="p-name" className="w-56" value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} /></div>
            <div className="grid gap-1"><Label htmlFor="p-cc">کد مرکز هزینه</Label><Input id="p-cc" className="w-32" value={project.costCentreCode} onChange={(e) => setProject({ ...project, costCentreCode: e.target.value })} /></div>
            <div className="grid gap-1"><Label htmlFor="p-budget">بودجه</Label><MoneyInput id="p-budget" value={project.budget} onChange={(budget) => setProject({ ...project, budget })} /></div>
            <Button type="submit" disabled={!project.code || !project.name}>ثبت پروژه</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>قراردادها</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <Table>
            <TableHeader><TableRow><TableHead>کد</TableHead><TableHead>عنوان</TableHead><TableHead>طرف حساب</TableHead><TableHead>تاریخ</TableHead><TableHead>مبلغ</TableHead><TableHead>وضعیت</TableHead></TableRow></TableHeader>
            <TableBody>
              {contracts.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">هنوز قراردادی ثبت نشده است.</TableCell></TableRow>}
              {contracts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><Link className="text-primary underline" href={`/app/contracting/contracts/${c.id}`}>{c.code}</Link></TableCell>
                  <TableCell>{c.title}</TableCell>
                  <TableCell>{partyName(c.partyCode)}</TableCell>
                  <TableCell>{formatJalaliDate(c.contractDate)}</TableCell>
                  <TableCell><Money value={c.amount} suffix /></TableCell>
                  <TableCell>{CONTRACT_STATUS_LABEL[c.status]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await createContract({
                  code: contract.code, title: contract.title, side: contract.side, partyCode: contract.partyCode,
                  projectId: contract.projectId ? Number(contract.projectId) : undefined, contractDate: contract.contractDate,
                  amount: contract.amount, advanceAmount: contract.advanceAmount || undefined,
                });
                setContract({ ...contract, code: "", title: "", amount: "", advanceAmount: "" });
              });
            }}
          >
            <div className="grid gap-1"><Label htmlFor="c-code">کد قرارداد</Label><Input id="c-code" className="w-32" value={contract.code} onChange={(e) => setContract({ ...contract, code: e.target.value })} /></div>
            <div className="grid gap-1"><Label htmlFor="c-title">عنوان</Label><Input id="c-title" className="w-56" value={contract.title} onChange={(e) => setContract({ ...contract, title: e.target.value })} /></div>
            <div className="grid gap-1"><Label htmlFor="c-side">سمت ما</Label>
              <select id="c-side" className={SELECT} value={contract.side} onChange={(e) => setContract({ ...contract, side: e.target.value as ContractSide, partyCode: "" })}>
                {(Object.keys(SIDE_LABEL) as ContractSide[]).map((s) => <option key={s} value={s}>{SIDE_LABEL[s]}</option>)}
              </select></div>
            <div className="grid gap-1"><Label htmlFor="c-party">طرف حساب</Label>
              <select id="c-party" className={SELECT} value={contract.partyCode} onChange={(e) => setContract({ ...contract, partyCode: e.target.value })}>
                <option value="">انتخاب کنید</option>
                {fitting.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select></div>
            <div className="grid gap-1"><Label htmlFor="c-project">پروژه</Label>
              <select id="c-project" className={SELECT} value={contract.projectId} onChange={(e) => setContract({ ...contract, projectId: e.target.value })}>
                <option value="">بدون پروژه</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div className="grid gap-1"><Label htmlFor="c-date">تاریخ قرارداد</Label><JalaliDateInput id="c-date" value={contract.contractDate} onChange={(contractDate) => setContract({ ...contract, contractDate })} /></div>
            <div className="grid gap-1"><Label htmlFor="c-amount">مبلغ قرارداد</Label><MoneyInput id="c-amount" value={contract.amount} onChange={(amount) => setContract({ ...contract, amount })} /></div>
            <div className="grid gap-1"><Label htmlFor="c-adv">پیش‌پرداخت توافقی</Label><MoneyInput id="c-adv" value={contract.advanceAmount} onChange={(advanceAmount) => setContract({ ...contract, advanceAmount })} /></div>
            <Button type="submit" disabled={!contract.code || !contract.title || !contract.partyCode || !contract.contractDate || !contract.amount}>ثبت قرارداد</Button>
          </form>
        </CardContent>
      </Card>
    </EnterpriseRouteGuard>
  );
}
