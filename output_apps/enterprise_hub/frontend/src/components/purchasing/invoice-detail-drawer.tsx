"use client";

import { useState } from "react";
import { Check, CheckCircle, FileCheck, HelpCircle } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { acceptSupplierInvoice, postSupplierInvoice } from "@/lib/api/purchasing-client";
import { formatMinorMoney, formatQuantity } from "./purchasing-format";
import { formatJalaliDate } from "@/lib/fa-format";
import type { MatchStatus, SupplierInvoice } from "@/types/purchasing";

interface InvoiceDetailDrawerProps {
  invoice: SupplierInvoice | null;
  open: boolean;
  canApprove?: boolean;
  canPost?: boolean;
  onClose: () => void;
  onUpdated: (updated: SupplierInvoice) => void;
}

const MATCH_MAP: Record<MatchStatus, { label: string; color: string }> = {
  MATCHED: { label: "تطبیق کامل", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  QTY_MISMATCH: { label: "اختلاف مقدار", color: "text-amber-700 bg-amber-50 border-amber-200" },
  PRICE_MISMATCH: { label: "اختلاف قیمت", color: "text-rose-700 bg-rose-50 border-rose-200" },
  QTY_AND_PRICE_MISMATCH: { label: "اختلاف مقدار و قیمت", color: "text-red-700 bg-red-50 border-red-200" },
};

export function InvoiceDetailDrawer({
  invoice,
  open,
  canApprove = true,
  canPost = true,
  onClose,
  onUpdated,
}: InvoiceDetailDrawerProps) {
  const [acceptNote, setAcceptNote] = useState("");
  const [showAcceptForm, setShowAcceptForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!invoice) return null;

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptNote.trim()) {
      setError("لطفاً دلیل پذیرش اختلاف صورتحساب را وارد کنید.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await acceptSupplierInvoice(invoice.id, { note: acceptNote.trim() });
      onUpdated(res);
      setShowAcceptForm(false);
      setAcceptNote("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در پذیرش اختلاف صورتحساب.");
    } finally {
      setBusy(false);
    }
  };

  const handlePost = async () => {
    if (!confirm("آیا از صدور و ثبت سند حسابداری این صورتحساب اطمینان دارید؟")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postSupplierInvoice(invoice.id);
      onUpdated(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در ثبت سند صورتحساب.");
    } finally {
      setBusy(false);
    }
  };

  const isHeld = invoice.status === "HELD";
  const isMatched = invoice.status === "MATCHED";
  const isPosted = invoice.status === "POSTED";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`صورتحساب خرید ${invoice.number}`}
      description={`شماره فاکتور فروشنده: ${invoice.supplierRef} | تاریخ: ${invoice.invoiceDate}`}
      size="xl"
    >
      <div className="flex flex-col gap-6" data-testid="invoice-detail-view">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Status & Totals Card */}
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-border p-4 bg-muted/20 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">وضعیت تطبیق سه‌طرفه</p>
            <div className="mt-1">
              {isHeld && <Badge variant="destructive">معلق (دارای اختلاف)</Badge>}
              {isMatched && <Badge variant="outline" className="text-emerald-700 border-emerald-300">تطبیق‌یافته</Badge>}
              {isPosted && <Badge variant="default" className="bg-emerald-600">سند ثبت‌شده</Badge>}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">جمع جزء (بدون مالیات)</p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {formatMinorMoney(invoice.subtotal)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">مالیات بر ارزش افزوده</p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {formatMinorMoney(invoice.vat)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">مبلغ نهایی قابل پرداخت</p>
            <p className="mt-1 text-sm font-bold text-foreground text-indigo-600">
              {formatMinorMoney(invoice.total)}
            </p>
          </div>
        </div>

        {/* Acceptance / Journal Note */}
        {invoice.accepted && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs text-emerald-900">
            <span className="font-semibold">اختلاف توسط {invoice.acceptedBy} در {formatJalaliDate(invoice.acceptedAt)} پذیرفته شد:</span>{" "}
            {invoice.acceptNote}
          </div>
        )}

        {invoice.journalEntryId && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileCheck className="size-4 text-emerald-600" />
            <span>سند حسابداری ثبت‌شده:</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{invoice.journalEntryId}</code>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3">
          {isHeld && canApprove && !showAcceptForm && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAcceptForm(true)}
              className="gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50"
            >
              <CheckCircle className="size-4" />
              پذیرش اختلاف و تأیید (HELD → MATCHED)
            </Button>
          )}

          {isMatched && canPost && (
            <Button
              size="sm"
              onClick={handlePost}
              disabled={busy}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Check className="size-4" />
              صدور و ثبت سند حسابداری (GRNI / AP)
            </Button>
          )}
        </div>

        {/* Accept Note Form */}
        {showAcceptForm && (
          <form
            onSubmit={handleAccept}
            className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/30 p-4"
          >
            <Label htmlFor="accept-note" className="text-xs font-semibold text-amber-900">
              دلیل و مستندات پذیرش اختلاف قیمت / مقدار:
            </Label>
            <Input
              id="accept-note"
              placeholder="مثال: افزایش قیمت رسمی کارخانه پس از صدور سفارش، تأیید مدیریت بازرگانی"
              value={acceptNote}
              onChange={(e) => setAcceptNote(e.target.value)}
              required
              minLength={3}
              maxLength={500}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAcceptForm(false)}
                disabled={busy}
              >
                انصراف
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? "در حال ثبت..." : "تأیید و پذیرش اختلاف"}
              </Button>
            </div>
          </form>
        )}

        {/* 3-Way Match Lines Table */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">سطرهای تطبیق ۳-طرفه (سفارش، رسید، صورتحساب)</h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">کد کالا (SKU)</TableHead>
                  <TableHead className="text-center">مقدار صورتحساب</TableHead>
                  <TableHead className="text-center">قیمت واحد</TableHead>
                  <TableHead className="text-center">ارزش طبق سفارش</TableHead>
                  <TableHead className="text-center">ارزش طبق صورتحساب</TableHead>
                  <TableHead className="text-center">تفاوت قیمت</TableHead>
                  <TableHead className="text-center">وضعیت تطبیق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((line) => {
                  const match = MATCH_MAP[line.matchStatus] ?? {
                    label: line.matchStatus,
                    color: "text-muted-foreground",
                  };
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">{line.sku}</TableCell>
                      <TableCell className="text-center tabular-nums">
                        {formatQuantity(line.quantity)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {formatMinorMoney(line.unitPrice)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {formatMinorMoney(line.orderValue)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums font-semibold">
                        {formatMinorMoney(line.invoiceValue)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-xs">
                        {line.priceDifference === "0" ? "۰" : formatMinorMoney(line.priceDifference)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-block px-2 py-0.5 text-xs rounded-full border ${match.color}`}>
                          {match.label}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
