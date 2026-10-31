"use client";

import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";

import { useAction, useLoad } from "@/components/access/access-ui";
import { useAccess } from "@/components/app/access-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createRole, deleteRole, listRoles, updateRole } from "@/lib/api/access-client";
import { ACTION_LABELS, MODULE_LABELS, SYSTEM_ROLE_LABELS, type AccessModuleKey, type CustomRole, type RolesResponse } from "@/types/access";

function Matrix({
  catalogue, value, onChange, can, disabled,
}: {
  catalogue: RolesResponse["catalogue"];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  can: (p: string) => boolean;
  disabled?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr><th className="p-1 text-start" />{catalogue.actions.map((a) => <th key={a} className="p-1">{ACTION_LABELS[a]}</th>)}</tr>
        </thead>
        <tbody>
          {catalogue.modules.map((m: AccessModuleKey) => (
            <tr key={m} className="border-t border-border">
              <td className="p-1">{MODULE_LABELS[m]}</td>
              {catalogue.actions.map((a) => {
                const perm = `${m}:${a}`;
                return (
                  <td key={a} className="p-1 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${MODULE_LABELS[m]} ${ACTION_LABELS[a]}`}
                      checked={value.has(perm)}
                      disabled={disabled || !can(perm)}
                      onChange={(e) => {
                        const next = new Set(value);
                        if (e.target.checked) next.add(perm); else next.delete(perm);
                        onChange(next);
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RolesPanel() {
  const { can, org } = useAccess();
  const admin = can("members", "admin");
  const roles = useLoad<RolesResponse>((s) => listRoles(s));
  const action = useAction(roles.reload);
  const mine = new Set(org?.permissions ?? []);
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<CustomRole | null>(null);

  if (roles.loading) return <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>;
  if (!roles.data) return <Alert variant="destructive"><AlertDescription>{roles.error}</AlertDescription></Alert>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const done = await action.run(() => (editing ? updateRole(editing.id, { name, permissions: [...perms] }) : createRole(name, [...perms])));
    if (done) { setName(""); setPerms(new Set()); setEditing(null); }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="roles-panel">
      <section className="grid gap-2 md:grid-cols-2">
        {roles.data.system.filter((r) => !r.deprecated).map((r) => (
          <details key={r.key} className="rounded-xl border border-border p-3 text-sm">
            <summary className="cursor-pointer font-bold">{SYSTEM_ROLE_LABELS[r.key] ?? r.key} <span className="text-xs font-normal text-muted-foreground">({r.permissions.length} دسترسی)</span></summary>
            <Matrix catalogue={roles.data!.catalogue} value={new Set(r.permissions)} onChange={() => undefined} can={() => false} disabled />
          </details>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">نقش‌های سفارشی</h3>
        {roles.data.custom.length === 0 && <p className="text-xs text-muted-foreground">نقش سفارشی تعریف نشده است.</p>}
        {roles.data.custom.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm" data-testid="custom-role">
            <span>{r.name} <span className="text-xs text-muted-foreground">({r.permissions.length} دسترسی)</span></span>
            {admin && (
              <span className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setEditing(r); setName(r.name); setPerms(new Set(r.permissions)); }}>ویرایش</Button>
                <Button size="sm" variant="outline" aria-label={`حذف نقش ${r.name}`} disabled={action.busy} onClick={() => action.run(() => deleteRole(r.id))}><Trash2 className="size-4" aria-hidden="true" /></Button>
              </span>
            )}
          </div>
        ))}
      </section>

      {admin && (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-border p-4" aria-label="نقش سفارشی">
          <Label htmlFor="role-name">{editing ? "ویرایش نقش" : "نقش سفارشی جدید"}</Label>
          <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <p className="text-xs text-muted-foreground">فقط دسترسی‌هایی را می‌توانید بدهید که خودتان دارید.</p>
          <Matrix catalogue={roles.data.catalogue} value={perms} onChange={setPerms} can={(p) => mine.has(p)} />
          {action.error && <Alert variant="destructive"><AlertDescription>{action.error}</AlertDescription></Alert>}
          <div className="flex gap-2">
            <Button type="submit" disabled={action.busy || name.trim().length < 2}>{editing ? "ذخیره" : "ساخت نقش"}</Button>
            {editing && <Button type="button" variant="outline" onClick={() => { setEditing(null); setName(""); setPerms(new Set()); }}>انصراف</Button>}
          </div>
        </form>
      )}
    </div>
  );
}
