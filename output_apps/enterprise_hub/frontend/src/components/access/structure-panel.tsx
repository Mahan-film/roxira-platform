"use client";

import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";

import { SELECT_CLASS, useAction, useLoad } from "@/components/access/access-ui";
import { useAccess } from "@/components/app/access-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createBranch, createDepartment, deleteBranch, deleteDepartment, listBranches, listDepartments,
} from "@/lib/api/access-client";
import type { Branch, Department } from "@/types/access";

export function StructurePanel() {
  const { can } = useAccess();
  const admin = can("members", "admin");
  const branches = useLoad<Branch[]>((s) => listBranches(s));
  const departments = useLoad<Department[]>((s) => listDepartments(s));
  const reload = () => { branches.reload(); departments.reload(); };
  const action = useAction(reload);
  const [branch, setBranch] = useState("");
  const [parent, setParent] = useState("");
  const [dept, setDept] = useState("");
  const [deptBranch, setDeptBranch] = useState("");

  const addBranch = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => createBranch(branch.trim(), undefined, parent || undefined))) { setBranch(""); setParent(""); }
  };
  const addDept = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => createDepartment(dept.trim(), deptBranch || undefined))) setDept("");
  };
  const name = (id: string | null) => branches.data?.find((b) => b.id === id)?.name;

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="structure-panel">
      {action.error && <Alert variant="destructive" className="md:col-span-2"><AlertDescription>{action.error}</AlertDescription></Alert>}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">شعبه‌ها و زیرمجموعه‌ها</h3>
        {(branches.data ?? []).map((b) => (
          <div key={b.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm" data-testid="branch-row">
            <span>{b.parentId ? `${name(b.parentId)} ‹ ` : ""}{b.name}</span>
            {admin && <Button size="sm" variant="outline" aria-label={`حذف ${b.name}`} disabled={action.busy} onClick={() => action.run(() => deleteBranch(b.id))}><Trash2 className="size-4" aria-hidden="true" /></Button>}
          </div>
        ))}
        {admin && (
          <form onSubmit={addBranch} className="flex flex-wrap gap-2" aria-label="شعبه جدید">
            <Input aria-label="نام شعبه" placeholder="نام شعبه" value={branch} onChange={(e) => setBranch(e.target.value)} className="min-w-40 flex-1" />
            <select aria-label="شعبه والد" className={SELECT_CLASS} value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">بدون والد</option>
              {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <Button type="submit" disabled={action.busy || !branch.trim()}>افزودن شعبه</Button>
          </form>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">دپارتمان‌ها</h3>
        {(departments.data ?? []).map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm" data-testid="department-row">
            <span>{d.name}{d.branchId ? ` — ${name(d.branchId)}` : ""}</span>
            {admin && <Button size="sm" variant="outline" aria-label={`حذف ${d.name}`} disabled={action.busy} onClick={() => action.run(() => deleteDepartment(d.id))}><Trash2 className="size-4" aria-hidden="true" /></Button>}
          </div>
        ))}
        {admin && (
          <form onSubmit={addDept} className="flex flex-wrap gap-2" aria-label="دپارتمان جدید">
            <Input aria-label="نام دپارتمان" placeholder="نام دپارتمان" value={dept} onChange={(e) => setDept(e.target.value)} className="min-w-40 flex-1" />
            <select aria-label="شعبه دپارتمان" className={SELECT_CLASS} value={deptBranch} onChange={(e) => setDeptBranch(e.target.value)}>
              <option value="">بدون شعبه</option>
              {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <Button type="submit" disabled={action.busy || !dept.trim()}>افزودن دپارتمان</Button>
          </form>
        )}
      </section>
    </div>
  );
}
