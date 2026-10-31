"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  importErrorMessage,
  listImportFormats,
  type ImportSupportRow,
  type ImportSupportStatus,
} from "@/lib/api/data-import-suite-client";

const STATUS_LABEL: Record<ImportSupportStatus, string> = {
  supported: "پشتیبانی کامل",
  partial: "با محدودیت",
  heuristic: "حدسی (تأییدنشده)",
  guide: "فقط راهنما",
  unsupported: "پشتیبانی نمی‌شود",
};

const STATUS_CLASS: Record<ImportSupportStatus, string> = {
  supported: "bg-emerald-500/15 text-emerald-400",
  partial: "bg-amber-500/15 text-amber-400",
  heuristic: "bg-orange-500/15 text-orange-400",
  guide: "bg-sky-500/15 text-sky-400",
  unsupported: "bg-rose-500/15 text-rose-400",
};

/**
 * جدول صادقانهٔ قالب‌های پشتیبانی‌شده؛ مستقیم از سرور (`GET /formats`) خوانده می‌شود تا هیچ‌وقت با
 * پیاده‌سازی واقعی ناهمخوان نشود. همگام‌سازی پیوسته ادعا نمی‌شود.
 */
export function ImportSupportTable() {
  const [rows, setRows] = useState<ImportSupportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listImportFormats(controller.signal)
      .then(setRows)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(importErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  return (
    <details className="rounded-2xl border border-border/60 p-4">
      <summary className="cursor-pointer text-sm font-bold">
        فرمت‌های پشتیبانی‌شده (جدول صادقانه)
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        قالب فایل از روی محتوا تشخیص داده می‌شود، نه پسوند. دامپ‌های متنی
        MySQL/PostgreSQL/T-SQL فقط خوانده می‌شوند و اجرا نمی‌شوند. همگام‌سازی
        پیوسته وجود ندارد؛ هر ورود یک‌باره است و با یک دسته قابل بازگردانی است.
      </p>
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      {!rows && !error && (
        <p className="mt-2 text-xs text-muted-foreground">در حال بارگذاری...</p>
      )}
      {rows && (
        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>قالب</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead>توضیح</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.titleFa}
                    {row.extensions.length > 0 && (
                      <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
                        {row.extensions.join(" ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_CLASS[row.status]}>
                      {STATUS_LABEL[row.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.detailFa}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </details>
  );
}
