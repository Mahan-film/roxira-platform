"use client";

import { useState, type FormEvent } from "react";
import { Copy, Loader2, Send } from "lucide-react";

import { SELECT_CLASS, errorText, useAction, useLoad } from "@/components/access/access-ui";
import { useAccess } from "@/components/app/access-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createInvitation, listBranches, listInvitations, listRoles, revokeInvitation,
} from "@/lib/api/access-client";
import { SYSTEM_ROLE_LABELS, type Branch, type CreatedInvitation, type Invitation, type RolesResponse } from "@/types/access";

export function InvitationsPanel() {
  const { can } = useAccess();
  const admin = can("members", "admin");
  const list = useLoad<Invitation[]>((s) => listInvitations(s));
  const roles = useLoad<RolesResponse>((s) => listRoles(s));
  const branches = useLoad<Branch[]>((s) => listBranches(s));
  const action = useAction(list.reload);

  const [contact, setContact] = useState("");
  const [role, setRole] = useState("sales");
  const [branchId, setBranchId] = useState("");
  const [scoped, setScoped] = useState(false);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreated(null);
    const value = contact.trim();
    const isEmail = value.includes("@");
    const customId = role.startsWith("custom:") ? role.slice(7) : undefined;
    setSending(true);
    try {
      const res = await createInvitation({
        email: isEmail ? value : undefined,
        phone: value && !isEmail ? value : undefined,
        roleKey: customId ? "custom" : role,
        customRoleId: customId,
        branchId: branchId || undefined,
        branchScoped: scoped && branchId ? true : undefined,
        locale: "fa",
      });
      setCreated(res);
      setContact("");
      list.reload();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSending(false);
    }
  };

  const assignable = (roles.data?.system ?? []).filter((r) => !r.deprecated && r.key !== "owner");

  return (
    <div className="flex flex-col gap-4" data-testid="invitations-panel">
      {admin && (
        <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-border p-4 md:grid-cols-4" aria-label="دعوت همکار">
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="inv-contact">ایمیل یا شماره موبایل (اختیاری)</Label>
            <Input id="inv-contact" dir="ltr" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="colleague@example.com" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-role">نقش</Label>
            <select id="inv-role" className={SELECT_CLASS} value={role} onChange={(e) => setRole(e.target.value)}>
              {assignable.map((r) => <option key={r.key} value={r.key}>{SYSTEM_ROLE_LABELS[r.key] ?? r.key}</option>)}
              {(roles.data?.custom ?? []).map((r) => <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-branch">شعبه (اختیاری)</Label>
            <select id="inv-branch" className={SELECT_CLASS} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">—</option>
              {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {branchId && (
            <label className="flex items-center gap-2 text-xs md:col-span-3">
              <input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} />
              فقط به داده‌های همین شعبه دسترسی داشته باشد
            </label>
          )}
          <div className="md:col-span-4">
            <Button type="submit" disabled={sending}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <><Send className="size-4" aria-hidden="true" /> ساخت دعوت‌نامه</>}
            </Button>
          </div>
          {formError && <Alert variant="destructive" className="md:col-span-4"><AlertDescription>{formError}</AlertDescription></Alert>}
          {created && (
            <div className="flex flex-col gap-2 rounded-xl bg-emerald-500/10 p-3 text-xs md:col-span-4" data-testid="invite-created">
              <p>
                {created.emailed ? "دعوت‌نامه ایمیل شد. " : ""}
                این پیوند یک‌بار مصرف است و ۷ روز اعتبار دارد؛ آن را برای همکار بفرستید:
              </p>
              <div className="flex gap-2">
                <Input readOnly dir="ltr" value={created.link} aria-label="پیوند دعوت" data-testid="invite-link" onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" variant="outline" aria-label="کپی پیوند" onClick={() => navigator.clipboard?.writeText(created.link)}>
                  <Copy className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </form>
      )}

      {action.error && <Alert variant="destructive"><AlertDescription>{action.error}</AlertDescription></Alert>}
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="p-3 text-start">مقصد</th><th className="p-3 text-start">نقش</th><th className="p-3 text-start">انقضا</th>{admin && <th className="p-3" />}</tr>
          </thead>
          <tbody>
            {(list.data ?? []).length === 0 && <tr><td colSpan={4} className="p-4 text-center text-xs text-muted-foreground">دعوت‌نامهٔ بازی وجود ندارد.</td></tr>}
            {(list.data ?? []).map((i) => (
              <tr key={i.id} className="border-t border-border" data-testid="invitation-row">
                <td className="p-3" dir="ltr">{i.email ?? i.phone ?? "پیوند عمومی"}</td>
                <td className="p-3">{SYSTEM_ROLE_LABELS[i.roleKey] ?? i.roleKey}</td>
                <td className="p-3 text-xs">{new Date(i.expiresAt).toLocaleDateString("fa-IR")}</td>
                {admin && (
                  <td className="p-3">
                    <Button size="sm" variant="outline" disabled={action.busy} onClick={() => action.run(() => revokeInvitation(i.id))}>لغو</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
