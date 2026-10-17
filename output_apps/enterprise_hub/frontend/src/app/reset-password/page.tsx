"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JudgeAuthError, resetPasswordWithToken } from "@/lib/api/judge-auth-client";

const MIN_PASSWORD = 8;

function ResetPassword() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) {
      setError("پیوند بازیابی ناقص است. دوباره از «فراموشی رمز» درخواست دهید.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError("رمز عبور باید حداقل ۸ نویسه باشد.");
      return;
    }
    if (password !== confirm) {
      setError("تکرار رمز عبور یکسان نیست.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await resetPasswordWithToken(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof JudgeAuthError ? (err.details[0] ?? err.message) : "اتصال به سرور برقرار نشد.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0B111F] p-8 shadow-2xl">
      {done ? (
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-10 text-emerald-400" />
          <h1 className="mt-4 text-lg font-bold text-white">رمز عبور تغییر کرد</h1>
          <p className="mt-2 text-sm text-slate-300">اکنون با رمز جدید وارد شوید (برگهٔ ایمیل).</p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-xl bg-[#fbbf24] px-6 py-2.5 text-sm font-bold text-[#05080f] hover:bg-[#f59e0b]"
          >
            ورود به قاضی هوشمند
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <h1 className="text-lg font-bold text-white">تعیین رمز عبور جدید</h1>
          <div className="space-y-2">
            <Label htmlFor="new-password" className="text-slate-300">
              رمز عبور جدید
            </Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              dir="ltr"
              maxLength={128}
              className="h-11 border-white/10 bg-black/30 text-left text-slate-100"
            />
            <p className="text-xs text-slate-500">حداقل ۸ نویسه.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password" className="text-slate-300">
              تکرار رمز عبور
            </Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              dir="ltr"
              maxLength={128}
              className="h-11 border-white/10 bg-black/30 text-left text-slate-100"
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={loading}
            className="h-11 w-full bg-[#fbbf24] font-bold text-[#05080f] hover:bg-[#f59e0b]"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : "ذخیرهٔ رمز جدید"}
          </Button>
          <p className="text-center text-xs">
            <Link href="/" className="text-[#38bdf8] hover:underline">
              بازگشت به صفحهٔ اصلی
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-[#05080f] p-4">
      <Suspense fallback={<Loader2 className="size-8 animate-spin text-[#fbbf24]" />}>
        <ResetPassword />
      </Suspense>
    </main>
  );
}
