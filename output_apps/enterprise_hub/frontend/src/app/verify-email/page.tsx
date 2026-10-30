"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { JudgeAuthError, verifyEmailToken } from "@/lib/api/judge-auth-client";

type State = { kind: "loading" } | { kind: "ok"; message: string } | { kind: "error"; message: string };

function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const [fetched, setState] = useState<State>({ kind: "loading" });
  const started = useRef(false);
  const state: State = token
    ? fetched
    : { kind: "error", message: "پیوند تأیید ناقص است. از ایمیل خود دوباره آن را باز کنید." };

  useEffect(() => {
    // the link is single use: call exactly once even under React strict-mode double effects
    if (started.current || !token) return;
    started.current = true;
    verifyEmailToken(token)
      .then((message) => setState({ kind: "ok", message: message || "ایمیل شما تأیید شد." }))
      .catch((err) =>
        setState({
          kind: "error",
          message: err instanceof JudgeAuthError ? (err.details[0] ?? err.message) : "اتصال به سرور برقرار نشد.",
        }),
      );
  }, [token]);

  return (
    <div className="w-full max-w-md rounded-2xl border border-[var(--gh-border)] bg-[var(--gh-bg-2)] p-8 text-center shadow-2xl">
      {state.kind === "loading" && (
        <>
          <Loader2 className="mx-auto size-10 animate-spin text-[var(--gh-gold)]" />
          <p className="mt-4 text-sm text-slate-300">در حال تأیید ایمیل…</p>
        </>
      )}
      {state.kind === "ok" && (
        <>
          <CheckCircle2 className="mx-auto size-10 text-emerald-400" />
          <h1 className="mt-4 text-lg font-bold text-white">ایمیل تأیید شد</h1>
          <p className="mt-2 text-sm text-slate-300">{state.message}</p>
        </>
      )}
      {state.kind === "error" && (
        <>
          <XCircle className="mx-auto size-10 text-rose-400" />
          <h1 className="mt-4 text-lg font-bold text-white">تأیید ناموفق</h1>
          <p className="mt-2 text-sm text-slate-300">{state.message}</p>
          <p className="mt-2 text-xs text-slate-500">
            در پنجرهٔ ورود (برگهٔ ایمیل) می‌توانید ایمیل تأیید جدید بگیرید.
          </p>
        </>
      )}
      <Link
        href="/"
        className="mt-6 inline-block rounded-xl bg-[var(--gh-gold)] px-6 py-2.5 text-sm font-bold text-[var(--gh-on-gold)] hover:bg-[var(--gh-gold-strong)]"
      >
        ورود به قاضی هوشمند
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main dir="rtl" className="ghazi-theme flex min-h-screen items-center justify-center bg-[var(--gh-bg)] p-4">
      <Suspense fallback={<Loader2 className="size-8 animate-spin text-[var(--gh-gold)]" />}>
        <VerifyEmail />
      </Suspense>
    </main>
  );
}
