"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/observability/client-error-reporter";

/** Last-resort boundary (root layout failed). Reports the error and offers a reload. */
export default function GlobalError({
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
    <html lang="fa" dir="rtl">
      <body style={{ fontFamily: "sans-serif", padding: "2rem", textAlign: "center" }}>
        <h1>مشکلی پیش آمد</h1>
        <p>خطا ثبت شد. لطفاً دوباره تلاش کنید.</p>
        <button type="button" onClick={() => reset()}>
          تلاش دوباره
        </button>
      </body>
    </html>
  );
}
