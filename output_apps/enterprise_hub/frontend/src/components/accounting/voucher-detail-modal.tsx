"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileText, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getJournalEntry } from "@/lib/api/accounting-client";
import { formatMoneyRial } from "@/lib/fa-format";
import { formatPersianDate } from "@/lib/format";
import {
  JOURNAL_ENTRY_STATUS_LABELS,
  type JournalEntryResponse,
  JournalEntryStatus,
} from "@/types/accounting";
import { VoucherAttachments } from "./voucher-attachments";

interface VoucherDetailModalProps {
  journalEntryId: number | null;
  onClose: () => void;
}

export function VoucherDetailModal({
  journalEntryId,
  onClose,
}: VoucherDetailModalProps) {
  const [entry, setEntry] = useState<JournalEntryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!journalEntryId) {
      setEntry(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getJournalEntry(journalEntryId, controller.signal)
      .then((res) => {
        setEntry(res);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("خطا در دریافت جزئیات سند حسابداری.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [journalEntryId]);

  if (!journalEntryId) return null;

  const zeroBig = BigInt(0);
  const totalDebit = entry
    ? entry.lines.reduce((s, l) => s + BigInt(l.debit || 0), zeroBig)
    : zeroBig;
  const totalCredit = entry
    ? entry.lines.reduce((s, l) => s + BigInt(l.credit || 0), zeroBig)
    : zeroBig;
  const isBalanced = totalDebit === totalCredit && totalDebit > zeroBig;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-3">
            <FileText className="size-5 text-indigo-500" />
            <h3 className="text-base font-semibold text-foreground">
              مشاهده سند حسابداری {entry ? `شماره ${entry.entryNumber}` : ""}
            </h3>
            {entry && (
              <Badge
                variant={
                  entry.status === JournalEntryStatus.POSTED
                    ? "default"
                    : entry.status === JournalEntryStatus.DRAFT
                      ? "outline"
                      : "secondary"
                }
              >
                {JOURNAL_ENTRY_STATUS_LABELS[entry.status]}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} title="بستن (Esc)">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="rounded-lg bg-destructive/10 p-4 text-center text-sm text-destructive">
              {error}
            </div>
          ) : entry ? (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/30 p-3 sm:grid-cols-4 text-xs">
                <div>
                  <span className="text-muted-foreground">شماره سند:</span>{" "}
                  <span className="font-mono font-bold">{entry.entryNumber}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">تاریخ:</span>{" "}
                  <span className="font-medium">{formatPersianDate(entry.date)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">شماره دائم:</span>{" "}
                  <span className="font-mono">{entry.permanentNumber ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">وضعیت تراز:</span>{" "}
                  {isBalanced ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-3.5" /> تراز
                    </span>
                  ) : (
                    <span className="font-semibold text-rose-500">ناتراز</span>
                  )}
                </div>
                {entry.description && (
                  <div className="col-span-2 sm:col-span-4 border-t pt-2">
                    <span className="text-muted-foreground">شرح سند:</span>{" "}
                    <span className="font-medium text-foreground">{entry.description}</span>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">#</TableHead>
                      <TableHead className="w-28">کد حساب</TableHead>
                      <TableHead className="min-w-44">نام حساب</TableHead>
                      <TableHead className="w-24">تفصیلی</TableHead>
                      <TableHead className="min-w-48">شرح آرتیکل</TableHead>
                      <TableHead className="w-32 text-left">بدهکار</TableHead>
                      <TableHead className="w-32 text-left">بستانکار</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entry.lines.map((line, idx) => {
                      const debitBig = BigInt(line.debit || 0);
                      const creditBig = BigInt(line.credit || 0);
                      return (
                        <TableRow key={line.id}>
                          <TableCell className="text-center font-mono text-xs text-muted-foreground">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-semibold">
                            {line.accountCode}
                          </TableCell>
                          <TableCell className="text-sm font-medium">
                            {line.accountName || line.accountCode}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {line.partyCode || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {line.description || "—"}
                          </TableCell>
                          <TableCell className="text-left font-mono text-xs font-semibold">
                            {debitBig > zeroBig ? formatMoneyRial(String(debitBig)) : "—"}
                          </TableCell>
                          <TableCell className="text-left font-mono text-xs font-semibold">
                            {creditBig > zeroBig ? formatMoneyRial(String(creditBig)) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center justify-between rounded-lg bg-muted/40 px-4 py-2 text-xs">
                <span className="text-muted-foreground">جمع گردش سند:</span>
                <div className="flex items-center gap-6">
                  <div>
                    <span className="text-muted-foreground">جمع بدهکار: </span>
                    <span className="font-mono font-bold text-foreground">
                      {formatMoneyRial(String(totalDebit))}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">جمع بستانکار: </span>
                    <span className="font-mono font-bold text-foreground">
                      {formatMoneyRial(String(totalCredit))}
                    </span>
                  </div>
                </div>
              </div>

              <VoucherAttachments journalEntryId={entry.id} />
            </div>
          ) : null}
        </div>

        <div className="flex justify-end border-t px-5 py-2.5">
          <Button variant="outline" size="sm" onClick={onClose}>
            بستن
          </Button>
        </div>
      </div>
    </div>
  );
}
