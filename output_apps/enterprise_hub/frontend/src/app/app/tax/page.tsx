"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Send } from "lucide-react";

import {
  ErrorNotice,
  LoadingLine,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listInvoices } from "@/lib/api/invoicing-client";
import { ApiClientError } from "@/lib/api/http-client";
import {
  type SeasonalCsvKind,
  downloadSeasonalCsv,
  getMoadianStatus,
  getMoadianSubmission,
  getSeasonalTransactions,
  getSeasonalVat,
  submitToMoadian,
} from "@/lib/api/moadian-seasonal-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { InvoiceStatus, type InvoiceResponseDto } from "@/types/invoicing";
import {
  MOADIAN_STATUS_LABELS,
  type MoadianStatusResponse,
  type MoadianSubmissionResponse,
  type SeasonalTransactionsResponse,
  type SeasonalVatReport,
} from "@/types/moadian-seasonal";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 24;
const QUARTER_LABELS = ["بهار", "تابستان", "پاییز", "زمستان"];
const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm";

function currentJalali(): { year: number; quarter: number } {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: pick("year"), quarter: Math.ceil(pick("month") / 3) };
}

function MoadianCard() {
  const [status, setStatus] = useState<MoadianStatusResponse | null>(null);
  const [invoices, setInvoices] = useState<InvoiceResponseDto[]>([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [submission, setSubmission] = useState<MoadianSubmissionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [search, setSearch] = useState("");
  const selectedRef = useRef("");

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
    setPolling(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getMoadianStatus(controller.signal)
      .then(setStatus)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      });
    return () => {
      controller.abort();
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  /** Server-side filtered lookup (status + number/buyer search), never a client filter of one page. */
  const searchInvoices = useCallback(async (query: string) => {
    setError(null);
    try {
      const [issued, paid] = await Promise.all(
        [InvoiceStatus.ISSUED, InvoiceStatus.PAID].map((status) =>
          listInvoices({ status, search: query || undefined, limit: 50 }),
        ),
      );
      setInvoices([...issued.data, ...paid.data]);
    } catch (err) {
      setError(loadErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial list load
    void searchInvoices("");
  }, [searchInvoices]);

  const poll = useCallback((id: string, startCount: number) => {
    const tick = (count: number) => {
      setPolling(true);
      pollTimer.current = setTimeout(async () => {
        try {
          const next = await getMoadianSubmission(id);
          if (selectedRef.current !== id) return;
          setSubmission(next);
          const final =
            next.status === "SUCCESS" ||
            next.status === "FAILED" ||
            next.status === "ERROR";
          if (final || count + 1 >= MAX_POLLS) {
            setPolling(false);
            return;
          }
          tick(count + 1);
        } catch (err) {
          if (selectedRef.current !== id) return;
          setError(loadErrorMessage(err));
          setPolling(false);
        }
      }, POLL_INTERVAL_MS);
    };
    tick(startCount);
  }, []);

  /** Changing the invoice drops the previous one's polling/result and loads this invoice's own status. */
  async function selectInvoice(id: string) {
    stopPolling();
    setSubmission(null);
    setError(null);
    setInvoiceId(id);
    selectedRef.current = id;
    if (!id) return;
    try {
      const existing = await getMoadianSubmission(id);
      // Ignore a late answer for an invoice that is no longer selected.
      if (selectedRef.current !== id) return;
      setSubmission(existing);
      if (existing.status === "QUEUED" || existing.status === "SENT") poll(id, 0);
    } catch (err) {
      // 404 = never submitted: nothing to show.
      if (err instanceof ApiClientError && err.statusCode === 404) return;
      if (selectedRef.current === id) setError(loadErrorMessage(err));
    }
  }

  async function submit() {
    if (!invoiceId) return;
    setBusy(true);
    setError(null);
    stopPolling();
    try {
      const id = invoiceId;
      const result = await submitToMoadian(id);
      // Ignore a late answer for an invoice that is no longer selected.
      if (selectedRef.current !== id) return;
      setSubmission(result);
      poll(id, 0);
    } catch (err) {
      // 503 is the documented "flag off / key storage missing" answer.
      setError(
        err instanceof ApiClientError && err.statusCode === 503
          ? `ارسال ممکن نیست: ${err.details.join(" | ")}`
          : loadErrorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  const enabled = status?.enabled === true;
  const configured = status?.configured === true;
  const canSubmit = enabled && configured && invoiceId !== "" && !busy;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="size-4" /> اتصال به سامانه مودیان
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!status && !error && <LoadingLine show />}
        {status && !enabled && (
          <Alert>
            <AlertTitle>اتصال زنده خاموش است</AlertTitle>
            <AlertDescription>
              پرچم MOADIAN_ENABLED روی سرور فعال نیست؛ هیچ صورتحسابی به سامانه
              مودیان ارسال نمی‌شود. فعال‌سازی فقط پس از آزمون روی محیط آزمایشی
              سامانه و با تصمیم مدیر انجام می‌شود.
            </AlertDescription>
          </Alert>
        )}
        {status && enabled && !configured && (
          <Alert>
            <AlertTitle>اطلاعات اتصال ثبت نشده است</AlertTitle>
            <AlertDescription>
              شناسه حافظه مالیاتی، گواهی و کلید خصوصی این سازمان هنوز ثبت نشده
              است (PUT moadian/credentials).
            </AlertDescription>
          </Alert>
        )}
        {status && (
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant={enabled ? "default" : "outline"}>
              پرچم اتصال: {enabled ? "روشن" : "خاموش"}
            </Badge>
            <Badge variant={configured ? "default" : "outline"}>
              اطلاعات اتصال: {configured ? "ثبت‌شده" : "ثبت نشده"}
            </Badge>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="جست‌وجوی صورتحساب"
            placeholder="شماره یا نام خریدار"
            className={`${selectClass} w-48`}
            value={search}
            disabled={!enabled}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void searchInvoices(search.trim());
            }}
          />
          <Button variant="outline" size="sm" disabled={!enabled} onClick={() => void searchInvoices(search.trim())}>
            جست‌وجو
          </Button>
          <select
            aria-label="صورتحساب"
            className={selectClass}
            value={invoiceId}
            disabled={!enabled || busy}
            onChange={(e) => void selectInvoice(e.target.value)}
          >
            <option value="">انتخاب صورتحساب صادرشده…</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.taxInvoiceNumber} — {i.buyerInfo?.name}
              </option>
            ))}
          </select>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? "در حال ارسال…" : "ارسال به مودیان"}
          </Button>
        </div>

        {error && <ErrorNotice title="خطا" message={error} />}

        {submission && (
          <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={submission.status === "SUCCESS" ? "default" : submission.status === "SENT" || submission.status === "QUEUED" ? "outline" : "destructive"}>
                {MOADIAN_STATUS_LABELS[submission.status]}
              </Badge>
              {polling && <span className="text-muted-foreground">در حال پیگیری وضعیت…</span>}
            </div>
            <div className="text-muted-foreground">
              شماره مالیاتی: <span dir="ltr">{submission.taxId}</span>
              {submission.referenceNumber && (
                <> — شماره مرجع: <span dir="ltr">{submission.referenceNumber}</span></>
              )}
            </div>
            {submission.errors.length > 0 && (
              <ul className="list-disc ps-5 text-destructive">
                {submission.errors.map((e, i) => (
                  <li key={i}>
                    <span dir="ltr">{e.code}</span>: {e.message}
                  </li>
                ))}
              </ul>
            )}
            {submission.warnings.length > 0 && (
              <ul className="list-disc ps-5 text-muted-foreground">
                {submission.warnings.map((w, i) => (
                  <li key={i}>
                    <span dir="ltr">{w.code}</span>: {w.message}
                  </li>
                ))}
              </ul>
            )}
            {!polling && (submission.status === "QUEUED" || submission.status === "SENT") && (
              <Button variant="outline" size="sm" onClick={() => poll(submission.invoiceId, 0)}>
                ادامه پیگیری وضعیت
              </Button>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          نتیجه نمایش‌داده‌شده پاسخ استعلام سامانه است و تأیید نهایی پذیرش
          صورتحساب را باید در کارپوشه مالیاتی بررسی کنید. این ماژول هنوز روی
          محیط واقعی سامانه آزموده نشده است.
        </p>
      </CardContent>
    </Card>
  );
}

function SeasonalCard() {
  const [{ year: initialYear, quarter: initialQuarter }] = useState(currentJalali);
  const [year, setYear] = useState(initialYear);
  const [quarter, setQuarter] = useState(initialQuarter);
  const [vat, setVat] = useState<SeasonalVatReport | null>(null);
  const [tx, setTx] = useState<SeasonalTransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before each fetch
    setLoading(true);
    Promise.all([
      getSeasonalVat(year, quarter, controller.signal),
      getSeasonalTransactions(year, quarter, controller.signal),
    ])
      .then(([v, t]) => {
        setVat(v);
        setTx(t);
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
  }, [year, quarter]);

  async function download(kind: SeasonalCsvKind) {
    try {
      await downloadSeasonalCsv(kind, year, quarter);
    } catch (err) {
      setError(loadErrorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4" /> گزارش فصلی ارزش افزوده و معاملات
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="سال شمسی"
            type="number"
            min={1300}
            max={1600}
            className={`${selectClass} w-24`}
            value={year}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1300 && n <= 1600) setYear(n);
            }}
          />
          <select
            aria-label="فصل"
            className={selectClass}
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value))}
          >
            {QUARTER_LABELS.map((label, i) => (
              <option key={label} value={i + 1}>
                فصل {formatNumber(i + 1)} — {label}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => download("vat-seasonal")} disabled={loading || !vat}>
            <Download className="size-4" /> CSV ارزش افزوده
          </Button>
          <Button variant="outline" size="sm" onClick={() => download("seasonal-transactions")} disabled={loading || !tx}>
            <Download className="size-4" /> CSV فهرست فروش
          </Button>
          <Button variant="outline" size="sm" onClick={() => download("seasonal-purchases")} disabled={loading || !tx}>
            <Download className="size-4" /> CSV خرید و مالیات ورودی
          </Button>
        </div>
        <LoadingLine show={loading} />
        {error && <ErrorNotice title="خطا" message={error} />}

        {vat && (
          <>
            <p className="text-sm text-muted-foreground">
              بازه: <span dir="ltr">{vat.period.label}</span> — {formatNumber(vat.sales.invoiceCount)} صورتحساب
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>نرخ</TableHead>
                  <TableHead>تعداد سطر</TableHead>
                  <TableHead>مبلغ مشمول</TableHead>
                  <TableHead>مالیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vat.sales.byRate.map((r) => (
                  <TableRow key={r.rate}>
                    <TableCell>{formatNumber(r.rate * 100)}٪</TableCell>
                    <TableCell>{formatNumber(r.invoiceLines)}</TableCell>
                    <TableCell>{formatMoneyRial(Number(r.taxableBase))}</TableCell>
                    <TableCell>{formatMoneyRial(Number(r.vat))}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>جمع فروش</TableCell>
                  <TableCell />
                  <TableCell>{formatMoneyRial(Number(vat.sales.taxableBase))}</TableCell>
                  <TableCell>{formatMoneyRial(Number(vat.sales.vat))}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Alert>
              <AlertTitle>خرید و مالیات ورودی</AlertTitle>
              <AlertDescription>
                {formatNumber(vat.purchases.documentCount)} سند خرید (
                {formatNumber(vat.purchases.invoiceCount)} صورتحساب،{" "}
                {formatNumber(vat.purchases.captureCount)} سند ثبت‌شده) — مبلغ مشمول{" "}
                {formatMoneyRial(Number(vat.purchases.taxableBase))}، مالیات ورودی{" "}
                {formatMoneyRial(Number(vat.purchases.inputVat))}
                {vat.purchases.unreadableCaptures > 0
                  ? ` — ${formatNumber(vat.purchases.unreadableCaptures)} سند ثبت‌شده خوانا نبود و لحاظ نشد`
                  : ""}
                . کسر مالیات ورودی به تطبیق کارپوشه وابسته است که هنوز انجام نمی‌شود.
              </AlertDescription>
            </Alert>
          </>
        )}

        {tx && tx.rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>شماره</TableHead>
                <TableHead>تاریخ</TableHead>
                <TableHead>خریدار</TableHead>
                <TableHead>مشمول</TableHead>
                <TableHead>مالیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tx.rows.map((r) => (
                <TableRow key={r.taxInvoiceNumber}>
                  <TableCell dir="ltr">{r.taxInvoiceNumber}</TableCell>
                  <TableCell dir="ltr">{r.issuedAtJalali}</TableCell>
                  <TableCell>{r.buyerName}</TableCell>
                  <TableCell>{formatMoneyRial(Number(r.taxableBase))}</TableCell>
                  <TableCell>{formatMoneyRial(Number(r.vat))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {tx && tx.rows.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">در این فصل صورتحساب صادرشده‌ای ثبت نشده است.</p>
        )}

        {vat && (
          <ul className="list-disc ps-5 text-xs text-muted-foreground">
            {vat.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function TaxPage() {
  return (
    <EnterpriseRouteGuard>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="مالیات و مودیان"
          description="ارسال صورتحساب به سامانه مودیان (پیش‌فرض خاموش) و گزارش فصلی ارزش افزوده و معاملات."
        />
        <MoadianCard />
        <SeasonalCard />
      </div>
    </EnterpriseRouteGuard>
  );
}
