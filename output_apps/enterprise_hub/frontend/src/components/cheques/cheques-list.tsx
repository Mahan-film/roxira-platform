"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { cn } from "cn";

import { ErrorNotice, loadErrorMessage } from "@/components/app/app-ui";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getJournalEntry } from "@/lib/api/accounting-client";
import { listBankAccounts } from "@/lib/api/banking-client";
import { listCheques, partialPayment, transitionCheque, verifySayad } from "@/lib/api/cheques-client";
import {
  canPartialPay,
  chipTone,
  countByStatus,
  isValidNationalId,
  newestEventWithEntry,
  partialAmountError,
  sortByUrgency,
  statusesFor,
  toLatinDigits,
  voucherNoticeText,
} from "@/lib/cheques-ui";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { printChequeReceipt } from "@/lib/print/open-cheque-receipt-window";
import type { BankAccount } from "@/types/banking";
import {
  ACTION_LABELS,
  DIRECTION_LABELS,
  SAYAD_REGISTRATION_LABELS,
  STATUS_LABELS,
  type Cheque,
  type ChequeDirection,
  type ChequeStatus,
} from "@/types/cheques";

import { ChequeForm } from "./cheque-form";

const SELECT_CLASS = "h-8 rounded-lg border border-input bg-background px-2 text-sm";
const todayIso = () => new Date().toISOString().slice(0, 10);

/** chipTone → Badge variant; the chip always shows its text label too, so colour is never the only signal. */
const CHIP_VARIANT = { neutral: "secondary", info: "outline", success: "default", danger: "destructive" } as const;
const CHIP_CLASS = "min-h-11 cursor-pointer gap-1 px-3 sm:min-h-8";

type Panel = { kind: "endorse" | "partial" | "clear"; id: number } | null;

export function ChequesList({
  direction,
  formOpen,
  onFormOpenChange,
  onChanged,
}: {
  direction: ChequeDirection;
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [status, setStatus] = useState<ChequeStatus | "all">("all");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [endorseName, setEndorseName] = useState("");
  const [endorseCode, setEndorseCode] = useState("");
  const [endorseNational, setEndorseNational] = useState("");
  const [partialText, setPartialText] = useState("");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [voucherNotice, setVoucherNotice] = useState<string | null>(null);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    listBankAccounts(controller.signal)
      .then(setBankAccounts)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  // The direction tab lives in the view; on change reset the status filter and show the fresh load.
  const firstDirection = useRef(true);
  useEffect(() => {
    if (firstDirection.current) {
      firstDirection.current = false;
      return;
    }
    setStatus("all");
    setLoading(true);
  }, [direction]);

  // Server filters: direction and the due window only — the status filter is applied in memory
  // so the chips can toggle instantly without a refetch.
  useEffect(() => {
    const controller = new AbortController();
    listCheques(
      {
        direction,
        dueFrom: dueFrom || undefined,
        dueTo: dueTo || undefined,
      },
      controller.signal,
    )
      .then((rows) => {
        setCheques(rows);
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
  }, [direction, dueFrom, dueTo, refreshKey]);

  const counts = useMemo(() => countByStatus(cheques), [cheques]);

  const visible = useMemo(() => {
    const q = toLatinDigits(query).toLowerCase();
    const rows = cheques
      .filter((c) => status === "all" || c.status === status)
      .filter((c) =>
        q ? [c.partyName, c.chequeNumber, c.sayadNumber ?? "", c.bankName ?? ""].some((v) => v.toLowerCase().includes(q)) : true,
      );
    return sortByUrgency(rows, todayIso());
  }, [cheques, query, status]);

  async function run(work: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setVoucherNotice(null);
    try {
      const message = await work();
      if (typeof message === "string") {
        setNotice(message);
      }
      setPanel(null);
      setEndorseName("");
      setEndorseCode("");
      setEndorseNational("");
      setPartialText("");
      setBankAccountId("");
      refresh();
      onChanged();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const move = (
    cheque: Cheque,
    next: ChequeStatus,
    extra: { spentToName?: string; spentToCode?: string; spentToNationalId?: string; bankAccountId?: number } = {},
  ) =>
    run(async () => {
      const detail = await transitionCheque(cheque.id, { status: next, eventDate: todayIso(), ...extra });
      const statusLabel = STATUS_LABELS[cheque.direction][next];
      const event = newestEventWithEntry(detail.events);
      if (!event?.journalEntryId) {
        setVoucherNotice(voucherNoticeText({ chequeNumber: cheque.chequeNumber, statusLabel, entryNumber: null }));
        return voucherNoticeText({ chequeNumber: cheque.chequeNumber, statusLabel, entryNumber: null });
      }
      try {
        const entry = await getJournalEntry(event.journalEntryId);
        const text = voucherNoticeText({ chequeNumber: cheque.chequeNumber, statusLabel, entryNumber: entry.entryNumber });
        setVoucherNotice(text);
        return text;
      } catch {
        const text = voucherNoticeText({ chequeNumber: cheque.chequeNumber, statusLabel, entryNumber: null });
        setVoucherNotice(text);
        return text;
      }
    });

  const selectedBankAccountId = bankAccountId ? Number(bankAccountId) : undefined;

  function submitClear(cheque: Cheque) {
    void move(cheque, "cleared", { bankAccountId: selectedBankAccountId });
  }

  function submitEndorse(cheque: Cheque) {
    const national = toLatinDigits(endorseNational).replace(/\s/g, "");
    if (national && !isValidNationalId(national)) {
      setError("کد ملی/شناسه ملی شخص ثالث معتبر نیست.");
      return;
    }
    void move(cheque, "spent", {
      spentToName: endorseName.trim(),
      spentToCode: endorseCode.trim() || undefined,
      spentToNationalId: national || undefined,
    });
  }

  function submitPartial(cheque: Cheque) {
    const problem = partialAmountError(partialText, cheque.remainingAmount);
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      await partialPayment(cheque.id, {
        amount: toLatinDigits(partialText).replace(/[,٬\s]/g, ""),
        eventDate: todayIso(),
        bankAccountId: selectedBankAccountId,
      });
      return `چک ${cheque.chequeNumber}: پرداخت بخشی ثبت شد.`;
    });
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        در حال بارگذاری...
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ErrorNotice title="خطا" message={error} />
      {notice && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
      {voucherNotice && <p className="rounded-lg bg-blue-500/10 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">{voucherNotice}</p>}

      {formOpen && (
        <ChequeForm
          onCancel={() => onFormOpenChange(false)}
          onCreated={() => {
            onFormOpenChange(false);
            setNotice("چک ثبت و سند حسابداری آن صادر شد.");
            refresh();
            onChanged();
          }}
        />
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle>فهرست چک‌ها</CardTitle>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <select aria-label="وضعیت" value={status} onChange={(e) => setStatus(e.target.value as ChequeStatus | "all")} className={SELECT_CLASS}>
              <option value="all">همه وضعیت‌ها</option>
              {statusesFor(direction).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[direction][s]}
                </option>
              ))}
            </select>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">سررسید از</span>
              <JalaliDateInput value={dueFrom} onChange={setDueFrom} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">سررسید تا</span>
              <JalaliDateInput value={dueTo} onChange={setDueTo} />
            </label>
            <Input aria-label="جستجو" placeholder="جستجو: طرف حساب، سری، صیاد، بانک" value={query} onChange={(e) => setQuery(e.target.value)} className="w-64" />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div role="group" aria-label="فیلتر وضعیت" className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={status === "all"}
              onClick={() => setStatus("all")}
              className={cn(badgeVariants({ variant: status === "all" ? "default" : "outline" }), CHIP_CLASS)}
            >
              همه
              <span className="text-xs opacity-70">{formatNumber(cheques.length)}</span>
            </button>
            {statusesFor(direction).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
                className={cn(badgeVariants({ variant: CHIP_VARIANT[chipTone(s)] }), CHIP_CLASS, status === s && "ring-2 ring-ring/40")}
              >
                {STATUS_LABELS[direction][s]}
                <span className="text-xs opacity-70">{formatNumber(counts[s] ?? 0)}</span>
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">چکی با این فیلترها یافت نشد.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>نوع</TableHead>
                  <TableHead>شناسه صیاد</TableHead>
                  <TableHead>سری / بانک</TableHead>
                  <TableHead>طرف حساب</TableHead>
                  <TableHead>مبلغ / مانده</TableHead>
                  <TableHead>سررسید</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead>اقدام</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((cheque) => (
                  <TableRow key={cheque.id}>
                    <TableCell>{DIRECTION_LABELS[cheque.direction]}</TableCell>
                    <TableCell className="text-xs">
                      <span dir="ltr" className="font-mono">{cheque.sayadNumber ?? "—"}</span>
                      {cheque.sayadNumber && (
                        <span className="block text-muted-foreground">
                          {SAYAD_REGISTRATION_LABELS[cheque.sayadRegistrationStatus]}
                          {" · "}
                          {cheque.sayadVerified
                            ? `تأییدشده دستی توسط ${cheque.sayadVerifiedBy ?? "—"}${cheque.sayadVerifiedAt ? ` در ${formatJalaliDate(cheque.sayadVerifiedAt)}` : ""}`
                            : "تأییدنشده"}
                        </span>
                      )}
                      {cheque.receiverNationalId && <span dir="ltr" className="block text-muted-foreground">دریافت‌کننده: {cheque.receiverNationalId}</span>}
                    </TableCell>
                    <TableCell>
                      <span dir="ltr">{cheque.chequeNumber}</span>
                      {cheque.bankName && <span className="block text-xs text-muted-foreground">{cheque.bankName}</span>}
                    </TableCell>
                    <TableCell>
                      {cheque.partyName}
                      {cheque.spentToName && <span className="block text-xs text-muted-foreground">خرج به: {cheque.spentToName}</span>}
                    </TableCell>
                    <TableCell>
                      {formatMoneyRial(Number(cheque.amount))}
                      {Number(cheque.settledAmount) > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          پرداخت‌شده {formatMoneyRial(Number(cheque.settledAmount))} · مانده {formatMoneyRial(Number(cheque.remainingAmount))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{formatJalaliDate(cheque.dueDate)}</TableCell>
                    <TableCell>
                      <Badge variant={cheque.status === "bounced" ? "destructive" : "secondary"}>{STATUS_LABELS[cheque.direction][cheque.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      {panel?.id === cheque.id && panel.kind === "endorse" ? (
                        <div className="flex flex-col gap-1">
                          <Input aria-label="نام شخص ثالث" placeholder="خرج به (نام)" value={endorseName} onChange={(e) => setEndorseName(e.target.value)} />
                          <Input aria-label="کد طرف حساب" dir="ltr" placeholder="کد طرف حساب (اختیاری)" value={endorseCode} onChange={(e) => setEndorseCode(e.target.value)} />
                          <Input aria-label="کد ملی" dir="ltr" placeholder="کد/شناسه ملی (اختیاری)" value={endorseNational} onChange={(e) => setEndorseNational(e.target.value)} />
                          <div className="flex gap-1">
                            <Button size="sm" disabled={busy || !endorseName.trim()} onClick={() => submitEndorse(cheque)}>تأیید خرج</Button>
                            <Button size="sm" variant="outline" onClick={() => setPanel(null)}>لغو</Button>
                          </div>
                        </div>
                      ) : panel?.id === cheque.id && panel.kind === "clear" ? (
                        <div className="flex flex-col gap-1">
                          <select aria-label="حساب بانکی" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={SELECT_CLASS}>
                            <option value="">حساب پیش‌فرض (۱۰۱۰)</option>
                            {bankAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name} — {account.ledgerAccountCode}
                              </option>
                            ))}
                          </select>
                          <div className="flex gap-1">
                            <Button size="sm" disabled={busy} onClick={() => submitClear(cheque)}>
                              ثبت {ACTION_LABELS[cheque.direction].cleared}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setPanel(null)}>لغو</Button>
                          </div>
                        </div>
                      ) : panel?.id === cheque.id && panel.kind === "partial" ? (
                        <div className="flex flex-col gap-1">
                          <Input aria-label="مبلغ پرداخت بخشی" dir="ltr" inputMode="decimal" placeholder={`کمتر از ${formatMoneyRial(Number(cheque.remainingAmount))}`} value={partialText} onChange={(e) => setPartialText(e.target.value)} />
                          <select aria-label="حساب بانکی" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={SELECT_CLASS}>
                            <option value="">حساب پیش‌فرض (۱۰۱۰)</option>
                            {bankAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name} — {account.ledgerAccountCode}
                              </option>
                            ))}
                          </select>
                          <div className="flex gap-1">
                            <Button size="sm" disabled={busy || !partialText.trim()} onClick={() => submitPartial(cheque)}>ثبت پرداخت بخشی</Button>
                            <Button size="sm" variant="outline" onClick={() => setPanel(null)}>لغو</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {cheque.allowedNext
                            .filter((next) => !(next === "spent" && Number(cheque.settledAmount) > 0))
                            .map((next) => (
                              <Button
                                key={next}
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  if (next === "spent") {
                                    setPanel({ kind: "endorse", id: cheque.id });
                                  } else if (next === "cleared") {
                                    setBankAccountId("");
                                    setPanel({ kind: "clear", id: cheque.id });
                                  } else {
                                    void move(cheque, next);
                                  }
                                }}
                              >
                                {ACTION_LABELS[cheque.direction][next] ?? next}
                              </Button>
                            ))}
                          {canPartialPay(cheque) && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                setBankAccountId("");
                                setPanel({ kind: "partial", id: cheque.id });
                              }}
                            >
                              پرداخت بخشی
                            </Button>
                          )}
                          {cheque.sayadNumber && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await verifySayad(cheque.id, { verified: !cheque.sayadVerified, sayadRegistrationStatus: cheque.sayadVerified ? undefined : "registered" });
                                  return cheque.sayadVerified ? "تأیید دستی صیاد لغو شد." : "تأیید دستی صیاد ثبت شد (با نام شما و زمان).";
                                })
                              }
                            >
                              {cheque.sayadVerified ? "لغو تأیید صیاد" : "تأیید دستی صیاد"}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => printChequeReceipt(cheque)}>
                            <Printer aria-hidden="true" />
                            چاپ
                          </Button>
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
