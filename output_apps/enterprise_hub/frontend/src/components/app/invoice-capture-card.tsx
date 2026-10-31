"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Undo2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadErrorMessage } from "@/components/app/app-ui";
import {
  fetchCaptureSource,
  postCapture,
  rejectCapture,
  reverseCapture,
  updateCapture,
} from "@/lib/api/invoice-capture-client";
import { cn } from "@/lib/utils";
import type { CaptureDraft, CaptureItem, CaptureStatus, CaptureView } from "@/types/invoice-capture";

const STATUS_LABEL: Record<CaptureStatus, string> = {
  draft: "پیش‌نویس",
  needs_review: "نیازمند بازبینی",
  posted: "ثبت‌شده",
  auto_posted: "ثبت خودکار",
  rejected: "ردشده",
  reversed: "برگشت‌خورده",
};

/** Field -> key of the model's self-reported confidence (shown beside the field). */
const FIELD_CONFIDENCE: Record<string, string> = {
  sellerName: "seller",
  sellerTaxId: "tax_id",
  invoiceNumber: "invoice_number",
  date: "date",
  tax: "tax",
  total: "total",
};

function ConfidenceDot({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  const tone = value >= 0.9 ? "bg-emerald-400" : value >= 0.7 ? "bg-amber-400" : "bg-rose-400";
  return (
    <span
      className={cn("inline-block size-2 rounded-full", tone)}
      title={`اطمینان مدل: ${Math.round(value * 100).toLocaleString("fa-IR")}٪`}
      aria-label={`اطمینان ${Math.round(value * 100)} درصد`}
    />
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  confidence?: number;
  ltr?: boolean;
  invalid?: boolean;
}

function Field({ label, value, onChange, disabled, confidence, ltr, invalid }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        {label}
        <ConfidenceDot value={confidence} />
      </span>
      <Input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        dir={ltr ? "ltr" : undefined}
        aria-invalid={invalid || undefined}
        className={cn("h-9 text-sm text-foreground", ltr && "text-left")}
      />
    </label>
  );
}

/**
 * Draft card of an invoice captured in the assistant chat: source image, confidence, every field
 * editable, validation findings, voucher preview and a one-click post. Posting goes through the
 * server (AccountingService); nothing here talks to the ledger directly.
 */
export function InvoiceCaptureCard({
  view,
  onChange,
}: {
  view: CaptureView;
  onChange: (next: CaptureView) => void;
}) {
  const [draft, setDraft] = useState<CaptureDraft>(view.draft);
  // Server state replaced (after a save/post): restart from it. Adjusting during render, not in an effect.
  const [seenView, setSeenView] = useState(view);
  if (seenView !== view) {
    setSeenView(view);
    setDraft(view.draft);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const editable = view.status === "draft" || view.status === "needs_review";
  const errors = view.findings.filter((finding) => finding.severity === "error");
  const warnings = view.findings.filter((finding) => finding.severity === "warning");
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.draft);


  useEffect(() => {
    if (view.sourceKind !== "image" && view.sourceKind !== "pdf") return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetchCaptureSource(view.id, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [view.id, view.sourceKind]);

  const run = async (name: string, action: () => Promise<CaptureView>) => {
    setBusy(name);
    setError(null);
    try {
      onChange(await action());
    } catch (caught) {
      setError(loadErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const patch = (changes: Partial<CaptureDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const patchItem = (index: number, changes: Partial<CaptureItem>) =>
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? { ...item, ...changes } : item)),
    }));
  const hasError = (field: string) => errors.some((finding) => finding.field === field);
  const conf = (field: string) => view.fieldConfidence[FIELD_CONFIDENCE[field] ?? ""];

  return (
    <section
      className="flex w-full max-w-3xl flex-col gap-3 self-end rounded-2xl border border-border bg-card p-4 text-sm"
      aria-label="پیش‌نویس سند از فاکتور"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold">
          {draft.kind === "purchase" ? "فاکتور خرید" : "فاکتور فروش"}
        </h3>
        <Badge variant={view.status === "posted" || view.status === "auto_posted" ? "default" : "secondary"}>
          {STATUS_LABEL[view.status]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          اطمینان کل: {Math.round(view.confidence * 100).toLocaleString("fa-IR")}٪
        </span>
        {view.model && (
          <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">
            {view.model}
          </span>
        )}
      </header>

      <div className="flex flex-col gap-3 md:flex-row">
        {imageUrl && view.sourceKind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element -- blob: URL of the user's own upload
          <img
            src={imageUrl}
            alt="تصویر فاکتور ارسال‌شده"
            className="max-h-72 w-full rounded-xl border border-border object-contain md:w-56"
          />
        )}
        {imageUrl && view.sourceKind === "pdf" && (
          <a href={imageUrl} target="_blank" rel="noreferrer" className="text-xs underline">
            باز کردن PDF ارسال‌شده
          </a>
        )}
        {view.transcript && (
          <p className="rounded-xl bg-muted p-3 text-xs leading-6">
            متن پیام صوتی: {view.transcript}
          </p>
        )}

        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="نام فروشنده" value={draft.sellerName} disabled={!editable} confidence={conf("sellerName")} onChange={(v) => patch({ sellerName: v })} invalid={hasError("sellerName")} />
          <Field label="شناسه ملی / کد اقتصادی فروشنده" value={draft.sellerTaxId} disabled={!editable} confidence={conf("sellerTaxId")} onChange={(v) => patch({ sellerTaxId: v })} ltr />
          <Field label="نام خریدار" value={draft.buyerName} disabled={!editable} onChange={(v) => patch({ buyerName: v })} />
          <Field label="شماره فاکتور" value={draft.invoiceNumber} disabled={!editable} confidence={conf("invoiceNumber")} onChange={(v) => patch({ invoiceNumber: v })} ltr />
          <Field label="تاریخ (میلادی YYYY-MM-DD)" value={draft.date ?? ""} disabled={!editable} confidence={conf("date")} onChange={(v) => patch({ date: v || null })} ltr invalid={hasError("date")} />
          <Field label="ارز" value={draft.currency} disabled={!editable} onChange={(v) => patch({ currency: v.toUpperCase().slice(0, 3) })} ltr />
          {draft.currency !== "IRR" && (
            <Field label="نرخ تبدیل به ریال" value={draft.fxRate ?? ""} disabled={!editable} onChange={(v) => patch({ fxRate: v || null })} ltr invalid={hasError("fxRate")} />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-bold text-muted-foreground">ردیف‌ها</h4>
        {draft.items.map((item, index) => (
          <div key={index} className="grid grid-cols-2 gap-2 rounded-xl border border-border p-2 sm:grid-cols-5">
            <div className="col-span-2">
              <Field label="شرح" value={item.description} disabled={!editable} onChange={(v) => patchItem(index, { description: v })} />
            </div>
            <Field label="تعداد" value={item.quantity} disabled={!editable} onChange={(v) => patchItem(index, { quantity: v })} ltr />
            <Field label="فی (ریال)" value={item.unitPrice} disabled={!editable} onChange={(v) => patchItem(index, { unitPrice: v })} ltr />
            <Field label="مبلغ" value={item.total} disabled={!editable} onChange={(v) => patchItem(index, { total: v })} ltr />
            <Field label="کد حساب" value={item.accountCode ?? ""} disabled={!editable} onChange={(v) => patchItem(index, { accountCode: v || null })} ltr invalid={hasError(`items.${index}`)} />
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2">
          <Field label="جمع قبل از مالیات" value={draft.subtotal} disabled={!editable} onChange={(v) => patch({ subtotal: v })} ltr invalid={hasError("subtotal")} />
          <Field label="مالیات" value={draft.tax} disabled={!editable} confidence={conf("tax")} onChange={(v) => patch({ tax: v })} ltr />
          <Field label="مبلغ کل" value={draft.total} disabled={!editable} confidence={conf("total")} onChange={(v) => patch({ total: v })} ltr invalid={hasError("total")} />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={draft.paid} disabled={!editable} onChange={(event) => patch({ paid: event.target.checked })} />
          نقدی پرداخت شده (بستانکار صندوق/بانک به‌جای حساب‌های پرداختنی)
        </label>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="flex flex-col gap-1 text-xs" role="list">
          {errors.map((finding, index) => (
            <li key={`e${index}`} className="flex items-start gap-1.5 text-rose-300">
              <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {finding.message}
            </li>
          ))}
          {warnings.map((finding, index) => (
            <li key={`w${index}`} className="flex items-start gap-1.5 text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {finding.message}
            </li>
          ))}
        </ul>
      )}

      {view.vendor.isNew && editable && (
        <p className="text-xs text-muted-foreground">
          «{view.vendor.name || "؟"}» فروشنده جدید است و با ثبت سند به فهرست فروشندگان اضافه می‌شود.
        </p>
      )}
      {view.autoReasons.length > 0 && (
        <p className="text-xs text-muted-foreground">
          ثبت خودکار انجام نشد: {view.autoReasons.join("، ")}
        </p>
      )}

      {view.voucher && (
        <details className="text-xs" open={editable}>
          <summary className="cursor-pointer font-bold text-muted-foreground">پیش‌نمایش سند حسابداری</summary>
          <table className="mt-2 w-full text-start">
            <thead className="text-muted-foreground">
              <tr><th>حساب</th><th>بدهکار</th><th>بستانکار</th></tr>
            </thead>
            <tbody dir="ltr">
              {view.voucher.lines.map((line, index) => (
                <tr key={index}>
                  <td>{line.accountCode}</td>
                  <td>{line.debit}</td>
                  <td>{line.credit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}

      <footer className="flex flex-wrap items-center gap-2">
        {editable && (
          <>
            <Button
              type="button"
              disabled={busy !== null || (!dirty && errors.length > 0)}
              onClick={() =>
                void run("post", async () => {
                  // Edits are saved and re-validated by the server first; then one click posts.
                  const current = dirty ? await updateCapture(view.id, draft) : view;
                  if (current.findings.some((finding) => finding.severity === "error")) return current;
                  return postCapture(view.id);
                })
              }
            >
              {busy === "post" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
              {dirty ? "ذخیره و ثبت سند" : "ثبت سند"}
            </Button>
            {dirty && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void run("save", () => updateCapture(view.id, draft))}>
                بررسی مجدد
              </Button>
            )}
            <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void run("reject", () => rejectCapture(view.id))}>
              رد
            </Button>
          </>
        )}
        {(view.status === "posted" || view.status === "auto_posted") && (
          <>
            <span className="text-xs text-muted-foreground">
              سند {view.entryNumber} {view.postedBy === "auto" ? "به‌صورت خودکار" : ""} ثبت شد. اصلاح فقط با سند برگشتی ممکن است.
            </span>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void run("reverse", () => reverseCapture(view.id))}>
              <Undo2 className="size-4" aria-hidden="true" />
              صدور سند برگشتی
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
