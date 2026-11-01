"use client";

import { Trash2 } from "lucide-react";

import { SELECT_CLASS, errorText, useAction, useLoad } from "@/components/access/access-ui";
import { CreateStaffForm } from "@/components/access/create-staff-form";
import { useAccess } from "@/components/app/access-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listBranches, listMembers, listRoles, removeMember, resetManagedPassword, updateMember } from "@/lib/api/access-client";
import { SYSTEM_ROLE_LABELS, type Branch, type Member, type RolesResponse } from "@/types/access";

const who = (m: Member) => m.displayName || m.loginEmail || m.username || m.phone || m.userId.slice(0, 8);

export function MembersPanel() {
  const { can, org } = useAccess();
  const admin = can("members", "admin");
  const members = useLoad<Member[]>((s) => listMembers(s));
  const roles = useLoad<RolesResponse>((s) => listRoles(s));
  const branches = useLoad<Branch[]>((s) => listBranches(s));
  const action = useAction(members.reload);

  const roleValue = (m: Member) => (m.roleKey === "custom" ? `custom:${m.customRoleId}` : m.roleKey);
  const changeRole = (m: Member, value: string) =>
    action.run(() =>
      value.startsWith("custom:")
        ? updateMember(m.id, { roleKey: "custom", customRoleId: value.slice(7) })
        : updateMember(m.id, { roleKey: value }),
    );

  if (members.loading) return <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>;
  if (members.error) return <Alert variant="destructive"><AlertDescription>{members.error}</AlertDescription></Alert>;

  const assignable = (roles.data?.system ?? []).filter((r) => !r.deprecated);
  const branchName = (id: string | null) => branches.data?.find((b) => b.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-3" data-testid="members-panel">
      {admin && <CreateStaffForm roles={roles.data} onCreated={members.reload} />}
      {action.error && <Alert variant="destructive"><AlertDescription>{action.error}</AlertDescription></Alert>}
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs font-semibold text-foreground">
            <tr>
              <th className="p-3 text-start">عضو</th>
              <th className="p-3 text-start">نقش</th>
              <th className="p-3 text-start">شعبه</th>
              <th className="p-3 text-start">وضعیت</th>
              {admin && <th className="p-3" />}
            </tr>
          </thead>
          <tbody>
            {(members.data ?? []).map((m) => (
              <tr key={m.id} className="border-t border-border" data-testid="member-row" data-member={who(m)}>
                <td className="p-3">
                  <div className="font-bold">{who(m)}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">{m.loginEmail ?? m.phone ?? ""}</div>
                </td>
                <td className="p-3">
                  {admin ? (
                    <select
                      aria-label={`نقش ${who(m)}`}
                      className={SELECT_CLASS}
                      value={roleValue(m)}
                      disabled={action.busy}
                      onChange={(e) => changeRole(m, e.target.value)}
                    >
                      {m.roleKey === "legacy_member" && <option value="legacy_member">{SYSTEM_ROLE_LABELS.legacy_member}</option>}
                      {assignable.map((r) => (
                        <option key={r.key} value={r.key}>{SYSTEM_ROLE_LABELS[r.key] ?? r.key}</option>
                      ))}
                      {(roles.data?.custom ?? []).map((r) => (
                        <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>
                      ))}
                    </select>
                  ) : (
                    <Badge variant="secondary">{SYSTEM_ROLE_LABELS[m.roleKey] ?? m.roleKey}</Badge>
                  )}
                </td>
                <td className="p-3 text-xs">{branchName(m.branchId)}{m.branchScoped ? " (محدود به شعبه)" : ""}</td>
                <td className="p-3">
                  <Badge variant={m.status === "ACTIVE" ? "secondary" : "destructive"}>
                    {m.status === "ACTIVE" ? "فعال" : "تعلیق"}
                  </Badge>
                </td>
                {admin && (
                  <td className="flex gap-2 p-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.busy}
                      onClick={() => action.run(() => updateMember(m.id, { status: m.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }))}
                    >
                      {m.status === "ACTIVE" ? "تعلیق" : "فعال‌سازی"}
                    </Button>
                    {m.managed && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={action.busy}
                        onClick={() => {
                          const password = window.prompt(`رمز جدید «${who(m)}» (حداقل ۱۰ نویسه)`);
                          if (password) action.run(() => resetManagedPassword(m.id, password));
                        }}
                      >
                        تغییر رمز
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`حذف ${who(m)}`}
                      disabled={action.busy}
                      onClick={() => {
                        if (window.confirm(`«${who(m)}» از سازمان حذف شود؟`)) action.run(() => removeMember(m.id));
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!admin && <p className="text-xs text-muted-foreground">فقط مالک و مدیر می‌توانند اعضا را تغییر دهند. نقش شما: {SYSTEM_ROLE_LABELS[org?.roleKey ?? ""] ?? org?.roleKey}</p>}
      {roles.error && <p className="text-xs text-rose-300">{roles.error || errorText(null)}</p>}
    </div>
  );
}
