"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";

import { ErrorNotice, StatCard, loadErrorMessage } from "@/components/app/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createCheque, listCheques, listDueCheques, transitionCheque } from "@/lib/api/cheques-client";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { isoToJalaliInput, jalaliToIso } from "@/lib/jalali";
import {
  ACTION_LABELS,
  DIRECTION_LABELS,
  STATUS_LABELS,
  type Cheque,
  type ChequeDirection,
  type ChequeStatus,
  type DueCheques,
} from "@/types/cheques";

const SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";
const todayIso = () => new Date().toISOString().slice(0, 10);
const toLatin = (value: string) =>
  value.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

function dueHint(days: number): string {
  if (days < 0) return `${formatNumber(-days)} روز معوق`;
  if (days === 0) return "امروز";
  return `${formatNumber(days)} روز دیگر`;
}

function ChequeForm({ onCreated, onCancel }: { onCreated: (cheque: Cheque) => void; onCancel: () => void }) {
  const [direction, setDirection] = useState<ChequeDirection>("received");
  const [sayad, setSayad] = useState("");
  const [sayadVerified, setSayadVerified] = useState(false);
  const [chequeNumber, setChequeNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [amount, setAmount] = useState("");
  const [issue, setIssue] = useState(() => isoToJalaliInput(todayIso()));
  const [due, setDue] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyCode, setPartyCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const issueDate = jalaliToIso(issue);
    const dueDate = jalaliToIso(due);
    if (!issueDate || !dueDate) {
      setError("تاریخ صدور و سررسید را شمسی و به شکل ۱۴۰۵/۰۸/۱۰ وارد کنید.");
      return;
    }
    const sayadNumber = toLatin(sayad).replace(/\s/g, "");
    if (sayadNumber && !/^\d{16}$/.test(sayadNumber)) {
      setError("شناسه صیاد باید ۱۶ رقم باشد.");
      return;
    }
    const amountText = toLatin(amount).replace(/[,٬\s]/g, "");
    if (!/^\d{1,16}(\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0) {
      setError("مبلغ باید عددی بزرگ‌تر از صفر با حداکثر دو رقم اعشار باشد.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await createCheque({
          direction,
          sayadNumber: sayadNumber || undefined,
          sayadVerified: sayadNumber ? sayadVerified : undefined,
          chequeNumber: toLatin(chequeNumber).trim(),
          bankName: bankName.trim() || undefined,
          amount: amountText,
          issueDate,
          dueDate,
          partyName: partyName.trim(),
          partyCode: partyCode.trim() || undefined,
        }),
      );
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>چک جدید</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ErrorNotice title="ثبت چک ناموفق بود" message={error} />
          </div>
          <label className="flex flex-col gap-1">
            <span>نوع چک</span>
            <select value={direction} onChange={(e) => setDirection(e.target.value as ChequeDirection)} className={SELECT_CLASS}>
              <option value="received">دریافتی از مشتری</option>
              <option value="issued">صادرشده به تأمین‌کننده</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>{direction === "received" ? "صادرکننده (مشتری)" : "ذی‌نفع"}</span>
            <Input required value={partyName} onChange={(e) => setPartyName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>شناسه صیاد (۱۶ رقم، اختیاری)</span>
            <Input dir="ltr" inputMode="numeric" value={sayad} onChange={(e) => setSayad(e.target.value)} placeholder="1234567890123456" />
          </label>
          <label className="flex items-end gap-2 pb-1">
            <input type="checkbox" checked={sayadVerified} onChange={(e) => setSayadVerified(e.target.checked)} />
            <span>در سامانه صیاد ثبت/تأیید شده است (اعلام شما؛ بررسی خودکار انجام نمی‌شود)</span>
          </label>
          <label className="flex flex-col gap-1">
            <span>شماره سری چک</span>
            <Input required dir="ltr" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>بانک</span>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>مبلغ (ریال)</span>
            <Input required dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>کد طرف حساب (اختیاری)</span>
            <Input dir="ltr" value={partyCode} onChange={(e) => setPartyCode(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>تاریخ صدور (شمسی)</span>
            <Input required dir="ltr" value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="1405/08/10" />
          </label>
          <label className="flex flex-col gap-1">
            <span>تاریخ سررسید (شمسی)</span>
            <Input required dir="ltr" value={due} onChange={(e) => setDue(e.target.value)} placeholder="1405/10/10" />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              ثبت چک و سند حسابداری
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              انصراف
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ChequesView() {
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [due, setDue] = useState<DueCheques | null>(null);
  const [direction, setDirection] = useState<ChequeDirection | "all">("all");
  const [status, setStatus] = useState<ChequeStatus | "all">("all");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [endorsing, setEndorsing] = useState<number | null>(null);
  const [endorseName, setEndorseName] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listCheques(
        {
          direction: direction === "all" ? undefined : direction,
          status: status === "all" ? undefined : status,
        },
        controller.signal,
      ),
      listDueCheques(30, controller.signal),
    ])
      .then(([rows, dueRows]) => {
        setCheques(rows);
        setDue(dueRows);
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
  }, [direction, status, refreshKey]);

  async function move(cheque: Cheque, next: ChequeStatus, spentToName?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await transitionCheque(cheque.id, { status: next, eventDate: todayIso(), spentToName });
      setNotice(`چک ${cheque.chequeNumber}: «${STATUS_LABELS[cheque.direction][next]}» ثبت شد.`);
      setEndorsing(null);
      setEndorseName("");
      refresh();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        در حال بارگذاری...
      </p>
    );
  }

  const overdueCount = due?.items.filter((item) => item.overdue).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <ErrorNotice title="خطا" message={error} />
      {notice && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="دریافتی تا ۳۰ روز آینده (و معوق)" value={formatMoneyRial(due ? Number(due.receivedTotal) : null)} />
        <StatCard label="پرداختی تا ۳۰ روز آینده (و معوق)" value={formatMoneyRial(due ? Number(due.issuedTotal) : null)} />
        <StatCard label="چک معوق" value={formatNumber(overdueCount)} hint="سررسید گذشته و هنوز وصول/پاس نشده" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>سررسیدهای پیش‌رو</CardTitle>
        </CardHeader>
        <CardContent>
          {due && due.items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>سررسید</TableHead>
                  <TableHead>نوع</TableHead>
                  <TableHead>طرف حساب</TableHead>
                  <TableHead>مبلغ</TableHead>
                  <TableHead>وضعیت زمانی</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {due.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatJalaliDate(item.dueDate)}</TableCell>
                    <TableCell>{DIRECTION_LABELS[item.direction]}</TableCell>
                    <TableCell>{item.partyName}</TableCell>
                    <TableCell>{formatMoneyRial(Number(item.amount))}</TableCell>
                    <TableCell>
                      <Badge variant={item.overdue ? "destructive" : "secondary"}>{dueHint(item.daysUntilDue)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">چکی با سررسید در ۳۰ روز آینده یا معوق وجود ندارد.</p>
          )}
        </CardContent>
      </Card>

      {showForm ? (
        <ChequeForm
          onCancel={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            setNotice("چک ثبت و سند حسابداری آن صادر شد.");
            refresh();
          }}
        />
      ) : (
        <div>
          <Button onClick={() => setShowForm(true)}>
            <Plus aria-hidden="true" />
            چک جدید
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>همه چک‌ها</CardTitle>
          <div className="flex gap-2 text-sm">
            <select aria-label="نوع چک" value={direction} onChange={(e) => setDirection(e.target.value as ChequeDirection | "all")} className={SELECT_CLASS}>
              <option value="all">همه انواع</option>
              <option value="received">دریافتی</option>
              <option value="issued">صادرشده</option>
            </select>
            <select aria-label="وضعیت" value={status} onChange={(e) => setStatus(e.target.value as ChequeStatus | "all")} className={SELECT_CLASS}>
              <option value="all">همه وضعیت‌ها</option>
              {(["registered", "deposited", "cleared", "bounced", "returned", "spent"] as ChequeStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS.received[s]}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {cheques.length === 0 ? (
            <p className="text-sm text-muted-foreground">چکی ثبت نشده است.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>نوع</TableHead>
                  <TableHead>شناسه صیاد</TableHead>
                  <TableHead>سری</TableHead>
                  <TableHead>طرف حساب</TableHead>
                  <TableHead>مبلغ</TableHead>
                  <TableHead>سررسید</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead>اقدام</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cheques.map((cheque) => (
                  <TableRow key={cheque.id}>
                    <TableCell>{DIRECTION_LABELS[cheque.direction]}</TableCell>
                    <TableCell dir="ltr" className="font-mono text-xs">
                      {cheque.sayadNumber ?? "—"}
                      {cheque.sayadNumber && !cheque.sayadVerified && <span className="ms-1 text-muted-foreground">(تأییدنشده)</span>}
                    </TableCell>
                    <TableCell dir="ltr">{cheque.chequeNumber}</TableCell>
                    <TableCell>
                      {cheque.partyName}
                      {cheque.spentToName && <span className="block text-xs text-muted-foreground">خرج به: {cheque.spentToName}</span>}
                    </TableCell>
                    <TableCell>{formatMoneyRial(Number(cheque.amount))}</TableCell>
                    <TableCell>{formatJalaliDate(cheque.dueDate)}</TableCell>
                    <TableCell>
                      <Badge variant={cheque.status === "bounced" ? "destructive" : "secondary"}>
                        {STATUS_LABELS[cheque.direction][cheque.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {endorsing === cheque.id ? (
                        <div className="flex gap-1">
                          <Input aria-label="نام شخص ثالث" placeholder="خرج به..." value={endorseName} onChange={(e) => setEndorseName(e.target.value)} />
                          <Button size="sm" disabled={busy || !endorseName.trim()} onClick={() => move(cheque, "spent", endorseName.trim())}>
                            تأیید
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEndorsing(null)}>
                            لغو
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {cheque.allowedNext.map((next) => (
                            <Button
                              key={next}
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => (next === "spent" ? setEndorsing(cheque.id) : move(cheque, next))}
                            >
                              {ACTION_LABELS[cheque.direction][next] ?? next}
                            </Button>
                          ))}
                        </div>
                      )}
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
