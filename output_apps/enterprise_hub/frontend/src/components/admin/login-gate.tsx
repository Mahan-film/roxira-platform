"use client";

/**
 * Sign-in for the owner console: the same phone + SMS code flow every user has (judge-auth-client).
 * Being able to sign in proves nothing about admin rights: the server checks the phone against
 * SMARTJUDGE_ADMIN_PHONES on every request and answers 403 to everyone else.
 */
import { useState } from "react";
import { isValidIranianMobile, JudgeAuthError, normalizePhone, sendJudgeOtp, verifyJudgeOtp } from "@/lib/api/judge-auth-client";
import { setAdminToken } from "@/lib/api/admin-console-client";
import { Btn, Card, Field, Notice, TextInput } from "./admin-ui";

export function LoginGate({ onSignedIn, reason }: { onSignedIn: () => void; reason?: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    if (!isValidIranianMobile(normalizePhone(phone))) {
      setError("شماره همراه باید ۱۱ رقم و با ۰۹ شروع شود.");
      return;
    }
    setBusy(true);
    try {
      await sendJudgeOtp(phone);
      setStep("code");
    } catch (e) {
      setError(e instanceof JudgeAuthError ? e.details.join(" ") : "ارسال کد ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError(null);
    setBusy(true);
    try {
      const session = await verifyJudgeOtp(phone, code);
      setAdminToken(session.accessToken);
      onSignedIn();
    } catch (e) {
      setError(e instanceof JudgeAuthError ? e.details.join(" ") : "تأیید کد ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-sm">
      <Card title="ورود مدیر">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void (step === "phone" ? send() : verify());
          }}
        >
          {reason && <Notice tone="warn">{reason}</Notice>}
          <Field label="شمارهٔ همراه مدیر">
            <TextInput dir="ltr" inputMode="tel" autoComplete="tel" placeholder="09xxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={step === "code"} />
          </Field>
          {step === "code" && (
            <Field label="کد پیامک‌شده">
              <TextInput dir="ltr" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            </Field>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          <Btn type="submit" disabled={busy}>{step === "phone" ? "ارسال کد" : "ورود"}</Btn>
          <p className="text-[11px] text-[var(--gh-muted)]">دسترسی فقط برای شماره‌های مدیر تعریف‌شده در سرور فعال است.</p>
        </form>
      </Card>
    </div>
  );
}
