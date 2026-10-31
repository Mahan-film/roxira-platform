"use client";

import { useState, type FormEvent } from "react";
import { Loader2, UserPlus } from "lucide-react";

import { SELECT_CLASS, errorText } from "@/components/access/access-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createManagedMember } from "@/lib/api/access-client";
import { SYSTEM_ROLE_LABELS, type RolesResponse } from "@/types/access";

/** Owner/admin creates a staff account directly and hands over the username and password. */
export function CreateStaffForm({ roles, onCreated }: { roles: RolesResponse | null; onCreated: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("sales");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setBusy(true);
    const customId = role.startsWith("custom:") ? role.slice(7) : undefined;
    try {
      const res = await createManagedMember({
        username: username.trim(),
        password,
        displayName: displayName.trim() || undefined,
        roleKey: customId ? "custom" : role,
        customRoleId: customId,
      });
      setCreated(res.username);
      setDisplayName("");
      setUsername("");
      setPassword("");
      onCreated();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-2" data-testid="create-staff-form">
      <h3 className="text-sm font-bold sm:col-span-2">ساخت کاربر با نام کاربری و رمز عبور</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="staff-name">نام</Label>
        <Input id="staff-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="staff-role">نقش</Label>
        <select id="staff-role" className={SELECT_CLASS} value={role} onChange={(e) => setRole(e.target.value)}>
          {(roles?.system ?? []).filter((r) => !r.deprecated).map((r) => (
            <option key={r.key} value={r.key}>{SYSTEM_ROLE_LABELS[r.key] ?? r.key}</option>
          ))}
          {(roles?.custom ?? []).map((r) => (
            <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="staff-username">نام کاربری</Label>
        <Input id="staff-username" dir="ltr" autoComplete="off" required minLength={3} value={username} onChange={(e) => setUsername(e.target.value)} />
        <p className="text-xs text-muted-foreground">نام کاربری در کل روکسیرا یکتاست؛ بهتر است پیشوند شرکت را در آن بیاورید.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="staff-password">رمز عبور</Label>
        <Input id="staff-password" dir="ltr" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="text-xs text-muted-foreground">حداقل ۱۰ نویسه.</p>
      </div>
      {error && <Alert variant="destructive" className="sm:col-span-2"><AlertDescription>{error}</AlertDescription></Alert>}
      {created && <p className="text-xs text-emerald-500 sm:col-span-2" role="status">کاربر <span dir="ltr">{created}</span> ساخته شد.</p>}
      <Button type="submit" disabled={busy} className="sm:col-span-2 sm:w-fit">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
        ساخت کاربر
      </Button>
    </form>
  );
}
