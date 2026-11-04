"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ErrorNotice, StatCard, loadErrorMessage } from "@/components/app/app-ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listBouncedCheques, listDueCheques } from "@/lib/api/cheques-client";
import { BOUNCED_BUCKET_LABELS, DUE_WINDOWS } from "@/lib/cheques-ui";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { DIRECTION_LABELS, STATUS_LABELS, type BouncedCheques, type ChequeDirection, type DueCheques } from "@/types/cheques";

const SELECT_CLASS = "h-8 rounded-lg border border-input bg-background px-2 text-sm";

function dueHint(days: number): string {
  if (days < 0) return `${formatNumber(-days)} روز معوق`;
  if (days === 0) return "امروز";
  return `${formatNumber(days)} روز دیگر`;
}

/** Loads a report whenever `key` changes; `loading` is derived (no state is set synchronously in the effect). */
function useReport<T>(load: (signal: AbortSignal) => Promise<T>, key: string) {
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((value) => setResult({ key, data: value, error: null }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResult({ key, data: null, error: loadErrorMessage(err) });
      });
    return () => controller.abort();
    // `load` is recreated every render and is fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = result?.key === key ? result : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: current === null };
}

const Loading = () => (
  <p className="flex items-center gap-2 text-sm text-muted-foreground">
    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
    در حال بارگذاری...
  </p>
);

/** Open cheques due in the next N days plus everything already overdue. */
export function DueReport() {
  const [days, setDays] = useState<number>(30);
  const [direction, setDirection] = useState<ChequeDirection | "all">("all");
  const { data, error, loading } = useReport<DueCheques>((signal) => listDueCheques(days, signal), `due:${days}`);
  const items = (data?.items ?? []).filter((i) => direction === "all" || i.direction === direction);
  const overdue = items.filter((i) => i.overdue).length;

  return (
    <div className="flex flex-col gap-4">
      <ErrorNotice title="خطا" message={error} />
      <div className="flex flex-wrap gap-2 text-sm">
        <select aria-label="بازه" value={days} onChange={(e) => setDays(Number(e.target.value))} className={SELECT_CLASS}>
          {DUE_WINDOWS.map((d) => (
            <option key={d} value={d}>
              سررسید تا {formatNumber(d)} روز آینده
            </option>
          ))}
        </select>
        <select aria-label="نوع چک" value={direction} onChange={(e) => setDirection(e.target.value as ChequeDirection | "all")} className={SELECT_CLASS}>
          <option value="all">دریافتی و صادرشده</option>
          <option value="received">دریافتی</option>
          <option value="issued">صادرشده</option>
        </select>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={`دریافتی تا ${formatNumber(days)} روز (و معوق)`} value={formatMoneyRial(data ? Number(data.receivedTotal) : null)} />
        <StatCard label={`صادرشده تا ${formatNumber(days)} روز (و معوق)`} value={formatMoneyRial(data ? Number(data.issuedTotal) : null)} />
        <StatCard label="چک معوق" value={formatNumber(overdue)} hint="سررسید گذشته و هنوز وصول/پاس نشده" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>چک‌های سررسیدشونده</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loading />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">چکی با سررسید در این بازه یا معوق وجود ندارد.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>سررسید</TableHead>
                  <TableHead>نوع</TableHead>
                  <TableHead>طرف حساب</TableHead>
                  <TableHead>سری</TableHead>
                  <TableHead>مانده</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead>زمان</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatJalaliDate(item.dueDate)}</TableCell>
                    <TableCell>{DIRECTION_LABELS[item.direction]}</TableCell>
                    <TableCell>{item.partyName}</TableCell>
                    <TableCell dir="ltr">{item.chequeNumber}</TableCell>
                    <TableCell>{formatMoneyRial(Number(item.remainingAmount))}</TableCell>
                    <TableCell>{STATUS_LABELS[item.direction][item.status]}</TableCell>
                    <TableCell>
                      <Badge variant={item.overdue ? "destructive" : "secondary"}>{dueHint(item.daysUntilDue)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Bounced cheques aged from their latest bounce, with totals per age bucket. */
export function BouncedReport() {
  const [direction, setDirection] = useState<ChequeDirection | "all">("all");
  const { data, error, loading } = useReport<BouncedCheques>(
    (signal) => listBouncedCheques({ direction: direction === "all" ? undefined : direction }, signal),
    `bounced:${direction}`,
  );

  return (
    <div className="flex flex-col gap-4">
      <ErrorNotice title="خطا" message={error} />
      <select aria-label="نوع چک" value={direction} onChange={(e) => setDirection(e.target.value as ChequeDirection | "all")} className={`${SELECT_CLASS} w-48`}>
        <option value="all">دریافتی و صادرشده</option>
        <option value="received">دریافتی</option>
        <option value="issued">صادرشده</option>
      </select>
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(data?.buckets ?? []).map((b) => (
              <StatCard
                key={b.bucket}
                label={BOUNCED_BUCKET_LABELS[b.bucket] ?? b.bucket}
                value={formatNumber(b.count)}
                hint={`دریافتی ${formatMoneyRial(Number(b.receivedTotal))} · صادرشده ${formatMoneyRial(Number(b.issuedTotal))}`}
              />
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>چک‌های برگشتی (مانده‌ی پرداخت‌نشده)</CardTitle>
            </CardHeader>
            <CardContent>
              {!data || data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">چک برگشتی باز وجود ندارد.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>تاریخ برگشت</TableHead>
                      <TableHead>سن</TableHead>
                      <TableHead>نوع</TableHead>
                      <TableHead>طرف حساب</TableHead>
                      <TableHead>سری</TableHead>
                      <TableHead>مانده</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{formatJalaliDate(item.bouncedOn)}</TableCell>
                        <TableCell>
                          <Badge variant={item.ageDays > 90 ? "destructive" : "secondary"}>
                            {formatNumber(item.ageDays)} روز · {BOUNCED_BUCKET_LABELS[item.bucket]}
                          </Badge>
                        </TableCell>
                        <TableCell>{DIRECTION_LABELS[item.direction]}</TableCell>
                        <TableCell>{item.partyName}</TableCell>
                        <TableCell dir="ltr">{item.chequeNumber}</TableCell>
                        <TableCell>{formatMoneyRial(Number(item.remainingAmount))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
