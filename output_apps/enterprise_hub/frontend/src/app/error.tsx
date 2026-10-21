"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, MessageSquare, RotateCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      className="dark ap-theme ghazi-theme flex min-h-dvh flex-col items-center justify-center px-4 py-16 text-center"
      data-theme="dark"
      dir="rtl"
      lang="fa"
    >
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-white/10 bg-[#0a0f1a] p-8 shadow-2xl shadow-black/60">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-lg shadow-orange-600/30">
          <AlertTriangle className="size-7" />
        </span>
        <div className="space-y-2">
          <h1 className="text-2xl font-black tracking-tight text-slate-100">خطایی رخ داد</h1>
          <p className="text-sm leading-relaxed text-slate-400">
            در پردازش این صفحه مشکلی پیش آمد. می‌توانید دوباره تلاش کنید یا به صفحهٔ اصلی بازگردید.
          </p>
          {error.digest ? (
            <p className="font-mono text-[11px] text-slate-500" dir="ltr">
              {error.digest}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-slate-100 transition-transform hover:-translate-y-0.5"
          >
            <RotateCw className="size-4" />
            تلاش دوباره
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-slate-100 transition-transform hover:-translate-y-0.5"
          >
            <Home className="size-4" />
            صفحهٔ اصلی
          </Link>
          <Link
            href="/chat"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-amber-500 to-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-transform hover:-translate-y-0.5"
          >
            <MessageSquare className="size-4" />
            گفتگو با قاضی هوشمند
          </Link>
        </div>
      </div>
    </div>
  );
}
