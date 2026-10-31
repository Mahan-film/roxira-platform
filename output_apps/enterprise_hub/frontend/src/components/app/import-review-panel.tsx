"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  reviewImportPackage,
  type ImportPackageCommitTable,
  type ImportPackageReview,
} from "@/lib/api/data-import-suite-client";
import { formatNumber } from "@/lib/fa-format";

/**
 * What the import will create, grouped the way an accountant reads it, and every proposed voucher
 * page by page. Rows come from the same builder the commit uses.
 */
export function ImportReviewPanel({
  packageId,
  selectionJson,
  required,
  onReviewed,
}: {
  packageId: string;
  selectionJson: string;
  required: boolean;
  onReviewed: (selectionJson: string) => void;
}) {
  const [review, setReview] = useState<ImportPackageReview | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      reviewImportPackage(
        packageId,
        { tables: JSON.parse(selectionJson) as ImportPackageCommitTable[] },
        page,
        controller.signal,
      )
        .then((next) => {
          setReview(next);
          onReviewed(selectionJson);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setReview(null);
          setError("بازبینی ساخته نشد. لطفاً دوباره تلاش کنید.");
        })
        .finally(() => setLoading(false));
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [packageId, selectionJson, page, onReviewed]);

  const vouchers = review?.vouchers;
  const pages = vouchers ? Math.max(1, Math.ceil(vouchers.total / vouchers.pageSize)) : 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          بازبینی پیش از ثبت
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {required && (
          <p className="rounded-md border border-amber-400/50 p-3 text-sm">
            این داده با OCR از تصویر خوانده شده است. هر سند را با فایل اصلی مقایسه کنید؛ چیزی خودکار ثبت نمی‌شود.
          </p>
        )}
        {error && <p className="text-sm text-rose-500">{error}</p>}
        {review && (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {review.groups.map((group) => (
                <div key={group.bucket} className="rounded-xl border border-border/60 p-3">
                  <p className="font-bold">{group.labelFa}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(group.validRows)} معتبر از {formatNumber(group.rows)} ردیف
                    {group.invalidRows > 0 ? ` · ${formatNumber(group.invalidRows)} نامعتبر` : ""}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {group.tables.map((t) => t.name).join("، ")}
                  </p>
                  {group.errorsFa.slice(0, 3).map((message) => (
                    <p key={message} className="mt-1 text-xs text-rose-500">
                      {message}
                    </p>
                  ))}
                </div>
              ))}
            </div>
            {review.skippedTables.length > 0 && (
              <p className="text-xs text-muted-foreground">نادیده گرفته می‌شود: {review.skippedTables.join("، ")}</p>
            )}
            {vouchers && vouchers.total > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-bold">
                  {formatNumber(vouchers.total)} سند پیشنهادی
                  {vouchers.unbalanced > 0 ? ` · ${formatNumber(vouchers.unbalanced)} سند نامتراز` : ""}
                </p>
                {vouchers.items.map((voucher) => (
                  <div key={`${voucher.sourceTable}-${voucher.voucherNo}`} className="rounded-lg border border-border/60 p-2 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {voucher.voucherNo}
                      {voucher.date && <span className="text-xs text-muted-foreground" dir="ltr">{voucher.date}</span>}
                      {!voucher.balanced && <Badge variant="destructive">نامتراز</Badge>}
                    </p>
                    <div className="mt-1 overflow-x-auto">
                      <table className="w-full min-w-96 text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-start font-normal">حساب</th>
                            <th className="text-start font-normal">شرح</th>
                            <th className="text-end font-normal">بدهکار</th>
                            <th className="text-end font-normal">بستانکار</th>
                          </tr>
                        </thead>
                        <tbody>
                          {voucher.lines.map((line, index) => (
                            <tr key={index}>
                              <td dir="ltr" className="text-start">{line.accountCode}</td>
                              <td>{line.description}</td>
                              <td className="text-end">{formatNumber(line.debit)}</td>
                              <td className="text-end">{formatNumber(line.credit)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                {pages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
                      قبلی
                    </Button>
                    <span className="text-xs">
                      صفحهٔ {formatNumber(page)} از {formatNumber(pages)}
                    </span>
                    <Button size="sm" variant="outline" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>
                      بعدی
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
