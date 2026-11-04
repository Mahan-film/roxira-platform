"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError } from "@/lib/api/http-client";
import {
  createOpeningDraft,
  deleteOpeningDraft,
  downloadOpeningTemplate,
  listWarehouses,
  markOpeningReviewed,
  postOpening,
  replaceOpeningLines,
} from "@/lib/api/inventory-client";
import { foldDigits, parseCsv } from "@/lib/csv";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import type { OpeningLine, OpeningReview, Warehouse } from "@/types/inventory";

interface OpeningBalanceDrawerProps {
  open: boolean;
  onClose: () => void;
  onPosted: () => void;
}

const SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

/** Reads the filled-in template. Cells left empty mean "not counted" and the row is skipped. */
function linesFromCsv(text: string): { lines: OpeningLine[]; skipped: number; error?: string } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { lines: [], skipped: 0, error: "فایل سطری ندارد." };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const sku = col("sku");
  const quantity = col("quantity");
  const cost = col("unit_cost");
  if (sku < 0 || quantity < 0 || cost < 0) {
    return { lines: [], skipped: 0, error: "ستون‌های sku، quantity و unit_cost لازم است (فایل الگو را دانلود کنید)." };
  }
  const lines: OpeningLine[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const code = (row[sku] ?? "").trim();
    const qtyText = foldDigits((row[quantity] ?? "").trim());
    if (!code || qtyText === "") {
      skipped += 1;
      continue;
    }
    const costText = foldDigits((row[cost] ?? "").trim());
    lines.push({
      sku: code.replace(/^'/, ""),
      quantity: Number(qtyText),
      unitCost: costText === "" ? 0 : Number(costText),
    });
  }
  const bad = lines.find((l) => !Number.isFinite(l.quantity) || !Number.isFinite(l.unitCost));
  if (bad) return { lines: [], skipped, error: `عدد نامعتبر برای کالای ${bad.sku}.` };
  return { lines, skipped };
}

/**
 * Opening balance for items that have no stock: pick the warehouse and as-of date, download the
 * template (items with empty quantity and cost), fill it with real counts and costs, upload,
 * read the review, confirm, post. Nothing is guessed: blank rows stay without stock.
 */
export function OpeningBalanceDrawer({ open, onClose, onPosted }: OpeningBalanceDrawerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [docDate, setDocDate] = useState("");
  const [review, setReview] = useState<OpeningReview | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    listWarehouses(controller.signal)
      .then((list) => setWarehouses(list.filter((w) => w.isActive)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [open]);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setErrors(null);
    try {
      return await action();
    } catch (error) {
      setErrors(error instanceof ApiClientError ? error.details : ["ارتباط با سرور برقرار نشد."]);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!warehouseId || !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) {
      setErrors(["انبار و تاریخ مبنا (مثل 2026-03-21) را وارد کنید."]);
      return;
    }
    const created = await run(() => createOpeningDraft({ toWarehouseId: Number(warehouseId), docDate }));
    if (created) setReview(created);
  }

  async function template() {
    const csv = await run(() => downloadOpeningTemplate());
    if (csv === undefined) return;
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "opening-balance-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !review) return;
    const parsed = linesFromCsv(await file.text());
    if (parsed.error) {
      setErrors([parsed.error]);
      return;
    }
    setSkipped(parsed.skipped);
    const next = await run(() => replaceOpeningLines(review.documentId, parsed.lines));
    if (next) setReview(next);
  }

  async function confirmReview() {
    if (!review) return;
    const next = await run(() => markOpeningReviewed(review.documentId));
    if (next) setReview(next);
  }

  async function post() {
    if (!review) return;
    const next = await run(() => postOpening(review.documentId, { lineCount: review.lineCount, totalValue: review.totalValue }));
    if (next) {
      setReview(next);
      onPosted();
    }
  }

  async function discard() {
    if (review && review.status === "DRAFT") {
      await run(() => deleteOpeningDraft(review.documentId));
    }
    setReview(null);
    onClose();
  }

  const posted = review?.status === "POSTED";

  return (
    <Drawer
      open={open}
      size="xl"
      title="موجودی اول دوره"
      description="فقط مقدارها و بهاهایی که واقعاً شمرده یا از سند خوانده‌اید وارد می‌شود؛ ردیف خالی یعنی «هنوز شمرده نشده» و موجودی نمی‌گیرد."
      onClose={onClose}
    >
      <div className="grid gap-4">
        {!review ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ob-wh">انبار</Label>
                <select id="ob-wh" className={SELECT_CLASS} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">انتخاب…</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ob-date">تاریخ مبنا (میلادی)</Label>
                <Input id="ob-date" dir="ltr" placeholder="2026-03-21" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
              </div>
            </div>
            <Button className="w-fit" disabled={busy} onClick={() => void start()}>ساخت پیش‌نویس</Button>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={posted ? "default" : "secondary"}>{posted ? "ثبت‌شده" : "پیش‌نویس"}</Badge>
              <span className="font-mono">{review.docNumber}</span>
              <span>تاریخ مبنا {review.docDate}</span>
            </div>

            {!posted && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void template()}>
                  <Download /> دانلود فایل الگو
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Upload /> بارگذاری فایل تکمیل‌شده
                </Button>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void upload(e)} />
              </div>
            )}

            <div className="grid gap-1 rounded-lg border p-3 text-sm">
              <div>تعداد سطر: <strong>{formatNumber(review.lineCount)}</strong></div>
              <div>جمع ارزش: <strong>{formatMoneyRial(review.totalValue)}</strong></div>
              <div className="text-muted-foreground">
                کالاهای بدون موجودی که در این سند نیامده‌اند: {formatNumber(review.itemsStillWithoutStock)}
                {skipped > 0 && ` · ردیف‌های خالی فایل نادیده گرفته شد: ${formatNumber(skipped)}`}
              </div>
            </div>

            {review.problems.length > 0 && (
              <div className="rounded-lg border border-destructive/40 p-3">
                <p className="mb-2 text-sm font-medium text-destructive">
                  {formatNumber(review.problems.length)} مشکل باید برطرف شود
                </p>
                <ul className="grid max-h-56 gap-1 overflow-y-auto text-xs" role="list">
                  {review.problems.slice(0, 200).map((p, i) => (
                    <li key={`${p.sku}-${p.code}-${i}`}>{p.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {!posted && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button
                  variant="secondary"
                  disabled={busy || review.lineCount === 0 || review.problems.length > 0 || review.reviewed}
                  onClick={() => void confirmReview()}
                >
                  {review.reviewed ? "بازبینی تأیید شد" : "تأیید بازبینی"}
                </Button>
                <Button disabled={busy || !review.canPost} onClick={() => void post()}>
                  ثبت نهایی ({formatNumber(review.lineCount)} سطر، {formatMoneyRial(review.totalValue)})
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void discard()}>
                  حذف پیش‌نویس
                </Button>
              </div>
            )}
            {posted && <p className="text-sm text-emerald-600">موجودی اول دوره ثبت شد و لایه‌های FIFO و سند حسابداری ساخته شد.</p>}
          </>
        )}

        {errors && (
          <ul className="list-disc space-y-1 ps-5 text-sm text-destructive" role="alert">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
