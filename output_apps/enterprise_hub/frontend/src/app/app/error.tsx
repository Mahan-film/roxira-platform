"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/observability/client-error-reporter";

/** Error boundary for the /app shell pages: reports the error and offers a retry. */
export default function AppError({
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
    <div className="mx-auto max-w-md p-8 text-center">
      <h2 className="text-lg font-semibold">مشکلی پیش آمد</h2>
      <p className="mt-2 text-sm text-muted-foreground">خطا ثبت شد. لطفاً دوباره تلاش کنید.</p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-4 rounded-md border px-4 py-2 text-sm"
      >
        تلاش دوباره
      </button>
    </div>
  );
}
