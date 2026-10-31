"use client";

import { useState, type FormEvent } from "react";
import { Building2, Loader2, MailPlus } from "lucide-react";

import { switchToOrganization } from "@/components/app/access-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInvitation, createOrganization } from "@/lib/api/access-client";
import { ApiClientError } from "@/lib/api/http-client";

/** Accepts a pasted invitation link or the bare token. */
export function tokenFromInvitation(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/account\/invite\/([A-Za-z0-9_-]+)/);
  return (match ? match[1] : trimmed.split("?")[0]).trim();
}

const errorText = (e: unknown) => (e instanceof ApiClientError ? e.details.join(" ") : "ارتباط با سرور برقرار نشد.");

/** Shown to a signed-in person who belongs to no organisation: create one, or join with an invitation. */
export function OrgOnboarding() {
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy("create");
    try {
      const { tenantId } = await createOrganization(name.trim());
      await switchToOrganization(tenantId);
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy("join");
    try {
      const { tenantId } = await acceptInvitation(tokenFromInvitation(invite));
      await switchToOrganization(tenantId);
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 md:grid-cols-2" data-testid="org-onboarding">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MailPlus className="size-4" aria-hidden="true" /> عضویت با دعوت‌نامه
          </CardTitle>
          <CardDescription>پیوند یا کد دعوتی که برایتان فرستاده‌اند را وارد کنید. نیازی به نام سازمان نیست.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={join} className="flex flex-col gap-3">
            <Label htmlFor="invite-link">پیوند یا کد دعوت</Label>
            <Input id="invite-link" dir="ltr" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="https://…/account/invite/…" />
            <Button type="submit" disabled={busy !== null || invite.trim().length < 20}>
              {busy === "join" ? <Loader2 className="size-4 animate-spin" /> : "پیوستن به سازمان"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" aria-hidden="true" /> ساخت سازمان جدید
          </CardTitle>
          <CardDescription>شما مالک سازمان می‌شوید و می‌توانید همکاران را دعوت کنید.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="flex flex-col gap-3">
            <Label htmlFor="org-name">نام سازمان</Label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
            <Button type="submit" disabled={busy !== null || name.trim().length < 2}>
              {busy === "create" ? <Loader2 className="size-4 animate-spin" /> : "ساخت سازمان"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive" className="md:col-span-2">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
