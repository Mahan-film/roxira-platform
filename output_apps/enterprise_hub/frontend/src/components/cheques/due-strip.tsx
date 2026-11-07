"use client";

import { useEffect, useState } from "react";

import { ErrorNotice, LoadingLine, loadErrorMessage } from "@/components/app/app-ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { listDueCheques } from "@/lib/api/cheques-client";
import { dueStripRows } from "@/lib/cheques-ui";
import { formatJalaliDate } from "@/lib/fa-format";
import type { ChequeDirection, DueCheques } from "@/types/cheques";

/** «سررسید ۷ روز آینده»: rolling 7-day window from today (server `days=7`), filtered to one direction. */
export function DueThisWeekStrip({ direction, today, refreshKey }: { direction: ChequeDirection; today: string; refreshKey: number }) {
  const [data, setData] = useState<DueCheques | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listDueCheques(7, controller.signal)
      .then((rows) => {
        setData(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  const total = data ? (direction === "received" ? data.receivedTotal : data.issuedTotal) : null;
  const rows = data ? dueStripRows(data.items, direction, today, 5) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>سررسید ۷ روز آینده</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <LoadingLine show={loading} />
        <ErrorNotice title="خطا" message={error} />
        {!loading && !error && data && (
          rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">چکی در ۷ روز آینده سررسید ندارد.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                جمع مبلغ: <Money value={total} />
              </p>
              <ul className="flex flex-col divide-y">
                {rows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                    <span className="font-medium">{row.partyName}</span>
                    <span dir="ltr" className="font-mono text-xs text-muted-foreground">{row.chequeNumber}</span>
                    <span>{formatJalaliDate(row.dueDate)}</span>
                    <Money value={row.amount} />
                    {row.overdue && <Badge variant="destructive">معوق</Badge>}
                  </li>
                ))}
              </ul>
            </>
          )
        )}
      </CardContent>
    </Card>
  );
}
