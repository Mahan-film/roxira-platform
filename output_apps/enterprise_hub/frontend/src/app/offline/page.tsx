import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "اتصال اینترنت برقرار نیست | قاضی هوشمند",
  description: "برای استفاده از سامانه قاضی هوشمند اتصال اینترنت خود را بررسی کنید.",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <div
      dir="rtl"
      lang="fa"
      className="min-h-dvh flex flex-col items-center justify-center gap-6 bg-slate-950 px-6 text-center font-sans text-slate-100"
    >
      <div className="flex size-16 items-center justify-center rounded-2xl bg-blue-900 text-amber-400">
        <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M1 1l22 22M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 0114 0M1.5 9a15 15 0 0121 0"
          />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold">اتصال اینترنت برقرار نیست</h1>
      <p className="max-w-md text-sm leading-7 text-slate-400">
        در حال حاضر به شبکه دسترسی نداریم. لطفاً اتصال اینترنت خود را بررسی کرده و دوباره تلاش کنید.
      </p>
      <Link
        href="/chat"
        className="rounded-xl bg-amber-400 px-6 py-3 text-sm font-semibold text-blue-950 transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
      >
        تلاش دوباره
      </Link>
      <p className="text-xs text-slate-500">قاضی هوشمند — دستیار تخصصی حقوقی و قضایی</p>
    </div>
  );
}
