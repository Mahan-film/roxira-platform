"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";

import { useAction, useLoad } from "@/components/access/access-ui";
import { useAccess } from "@/components/app/access-provider";
import { PageHeader } from "@/components/app/app-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  disableTotp, enableTotp, getSecurityPolicy, getTotpStatus, listSessions, revokeOtherSessions, revokeSession,
  setSecurityPolicy, startTotpSetup,
} from "@/lib/api/access-client";
import { refreshStoredSession } from "@/lib/api/session-store";
import type { SessionView } from "@/types/access";

function TotpCard() {
  const status = useLoad((s) => getTotpStatus(s));
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const action = useAction(status.reload);

  const begin = async () => setSetup((await action.run(() => startTotpSetup())) ?? null);
  const enable = async () => {
    const res = await action.run(() => enableTotp(code.trim()));
    if (res) {
      setCodes(res.recoveryCodes);
      setSetup(null);
      setCode("");
      await refreshStoredSession(true); // the new token says this session passed two-factor
    }
  };
  const disable = async () => {
    if (await action.run(() => disableTotp(code.trim()))) setCode("");
  };

  return (
    <Card data-testid="totp-card">
      <CardHeader>
        <CardTitle className="text-base">ورود دومرحله‌ای (برنامهٔ احراز هویت)</CardTitle>
        <CardDescription>با Google Authenticator، 1Password یا برنامه‌های مشابه. وضعیت: {status.data?.enabled ? <Badge variant="secondary">فعال</Badge> : <Badge variant="outline">غیرفعال</Badge>}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {action.error && <Alert variant="destructive"><AlertDescription>{action.error}</AlertDescription></Alert>}
        {!status.data?.enabled && !setup && <Button onClick={begin} disabled={action.busy}>شروع راه‌اندازی</Button>}
        {setup && (
          <div className="flex flex-col gap-2 text-sm">
            <p>این کلید را در برنامهٔ احراز هویت وارد کنید (یا پیوند otpauth را باز کنید)، سپس کد ۶ رقمی را بنویسید.</p>
            <code dir="ltr" className="break-all rounded-lg bg-muted p-2 text-xs" data-testid="totp-secret">{setup.secret}</code>
            <Label htmlFor="totp-code">کد ۶ رقمی</Label>
            <Input id="totp-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} autoComplete="one-time-code" />
            <Button onClick={enable} disabled={action.busy || code.trim().length !== 6}>فعال‌سازی</Button>
          </div>
        )}
        {codes && (
          <div role="status" className="rounded-xl bg-amber-500/10 p-3 text-xs" data-testid="recovery-codes">
            <p className="mb-2 font-bold">کدهای بازیابی را همین حالا در جای امن ذخیره کنید؛ دیگر نمایش داده نمی‌شوند. هر کد یک‌بار مصرف است.</p>
            <ul dir="ltr" className="grid grid-cols-2 gap-1 font-mono">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
        {status.data?.enabled && (
          <div className="flex flex-col gap-2 text-sm">
            <Label htmlFor="totp-off">برای غیرفعال‌کردن، یک کد یا کد بازیابی وارد کنید</Label>
            <Input id="totp-off" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} />
            <Button variant="outline" onClick={disable} disabled={action.busy || code.trim().length < 6}>غیرفعال‌سازی</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const sessions = useLoad<SessionView[]>((s) => listSessions(s));
  const action = useAction(sessions.reload);
  return (
    <Card data-testid="sessions-card">
      <CardHeader>
        <CardTitle className="text-base">دستگاه‌های وارد‌شده</CardTitle>
        <CardDescription>هر نشست را می‌توانید همین حالا ببندید.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {sessions.error && <Alert variant="destructive"><AlertDescription>{sessions.error}</AlertDescription></Alert>}
        {action.error && <Alert variant="destructive"><AlertDescription>{action.error}</AlertDescription></Alert>}
        {(sessions.data ?? []).map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm" data-testid="session-row">
            <div>
              <div className="font-bold">{s.device} {s.current && <Badge variant="secondary">این دستگاه</Badge>} {s.mfa && <Badge variant="outline">دومرحله‌ای</Badge>}</div>
              <div className="text-xs text-muted-foreground" dir="ltr">{s.ip ?? "—"} · {new Date(s.lastUsedAt).toLocaleString("fa-IR")}</div>
            </div>
            {!s.current && <Button size="sm" variant="outline" disabled={action.busy} onClick={() => action.run(() => revokeSession(s.id))}>پایان نشست</Button>}
          </div>
        ))}
        {(sessions.data ?? []).length > 1 && (
          <Button variant="outline" disabled={action.busy} onClick={() => action.run(() => revokeOtherSessions())}>خروج از همهٔ دستگاه‌های دیگر</Button>
        )}
      </CardContent>
    </Card>
  );
}

function PolicyCard() {
  const { can } = useAccess();
  const policy = useLoad((s) => getSecurityPolicy(s));
  const action = useAction(policy.reload);
  if (!can("security", "read")) return null;
  const admin = can("security", "admin");
  return (
    <Card data-testid="policy-card">
      <CardHeader>
        <CardTitle className="text-base">سیاست امنیتی سازمان</CardTitle>
        <CardDescription>اگر ورود دومرحله‌ای الزامی شود، اعضایی که آن را فعال نکرده‌اند به سامانه دسترسی ندارند.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {action.error && <Alert variant="destructive"><AlertDescription>{action.error}</AlertDescription></Alert>}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={policy.data?.require2fa ?? false}
            disabled={!admin || action.busy || !policy.data}
            onChange={(e) => action.run(() => setSecurityPolicy(e.target.checked))}
          />
          ورود دومرحله‌ای برای همهٔ اعضا الزامی باشد
        </label>
        {!admin && <p className="text-xs text-muted-foreground">فقط مالک سازمان می‌تواند این سیاست را تغییر دهد.</p>}
      </CardContent>
    </Card>
  );
}

export default function SecuritySettingsPage() {
  return (
    <>
      <PageHeader title="امنیت حساب" description="ورود دومرحله‌ای، دستگاه‌ها و سیاست امنیتی سازمان." icon={<ShieldCheck className="size-6 text-indigo-500" />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TotpCard />
        <SessionsCard />
        <PolicyCard />
      </div>
    </>
  );
}
