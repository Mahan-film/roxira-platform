"use client";

import { useEffect } from "react";
import Link from "next/link";

import { EnamadFooter } from "@/components/layout/enamad-footer";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { reportClientError } from "@/lib/observability/client-error-reporter";

/** Error boundary for /judge: reports the error and offers a retry or return link. */
export default function JudgeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError("boundary", error);
  }, [error]);

  return (
    <div
      className="dark ap-theme ghazi-theme flex min-h-dvh flex-col"
      data-theme="dark"
      dir="rtl"
      lang="fa"
    >
      <GhaziHeader />
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="mx-auto max-w-md p-8 text-center">
          <h2 className="text-lg font-semibold">مشکلی پیش آمد</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            خطا ثبت شد. لطفاً دوباره تلاش کنید یا به میز کار قاضی هوشمند بازگردید.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-md border px-4 py-2 text-sm"
            >
              تلاش دوباره
            </button>
            <Link href="/judge" className="rounded-md border px-4 py-2 text-sm">
              بازگشت به میز کار قاضی هوشمند
            </Link>
          </div>
        </div>
      </main>
      <EnamadFooter compact={true} />
    </div>
  );
}
