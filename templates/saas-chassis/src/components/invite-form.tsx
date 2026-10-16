"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inviteMember } from "@/app/(app)/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InviteForm() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    const res = await inviteMember({ email: f.get("email"), role: f.get("role") });
    setBusy(false);
    setMsg(res.ok ? "Invitation sent" : res.error);
    if (res.ok) {
      form.reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <Input name="email" type="email" required placeholder="colleague@example.com" aria-label="Email" />
      <select name="role" aria-label="Role" className="h-10 rounded-md border border-border bg-background px-2 text-sm">
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <Button type="submit" disabled={busy}>
        Invite
      </Button>
      {msg && <p role="status" className="self-center text-sm">{msg}</p>}
    </form>
  );
}
