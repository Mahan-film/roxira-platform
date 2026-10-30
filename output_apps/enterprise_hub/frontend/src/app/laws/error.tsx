"use client";

import { useEffect } from "react";
import Link from "next/link";

import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { reportClientError } from "@/lib/observability/client-error-reporter";

/** Error boundary for /laws pages: reports the error and offers a retry or return link. */
export default function LawsError({
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
    <LegalPageShell>
      <div className="mx-auto max-w-md p-8 text-center" dir="rtl">
        <h2 className="text-lg font-semibold">مشکلی پیش آمد</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          خطا ثبت شد. لطفاً دوباره تلاش کنید یا به فهرست قوانین بازگردید.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md border px-4 py-2 text-sm"
          >
            تلاش دوباره
          </button>
          <Link href="/laws" className="rounded-md border px-4 py-2 text-sm">
            بازگشت به فهرست قوانین
          </Link>
        </div>
      </div>
    </LegalPageShell>
  );
}
