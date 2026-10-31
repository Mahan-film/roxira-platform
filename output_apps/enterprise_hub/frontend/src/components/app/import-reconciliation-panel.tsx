"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  packageEntityLabel,
  type ImportReconciliationReport,
} from "@/lib/api/data-import-suite-client";
import { formatNumber } from "@/lib/fa-format";

/** گزارش مغایرت‌گیری پیش از ثبت: تعداد ردیف، جمع بدهکار/بستانکار، تراز اسناد، تکراری، ستون‌های بی‌نگاشت. */
export function ReconciliationPanel({
  report,
  loading,
  error,
  confirmImbalance,
  onConfirmImbalance,
}: {
  report: ImportReconciliationReport | null;
  loading: boolean;
  error: string | null;
  confirmImbalance: boolean;
  onConfirmImbalance: (value: boolean) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {report?.balanced === false ? (
            <ShieldAlert className="size-4 text-rose-400" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-4 text-emerald-400" aria-hidden="true" />
          )}
          مغایرت‌گیری پیش از ثبت
          {loading && <Badge variant="secondary">در حال محاسبه...</Badge>}
          {report && !loading && (
            <Badge
              className={
                report.balanced
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-rose-500/15 text-rose-400"
              }
            >
              {report.balanced ? "تراز است" : "عدم‌تراز"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {error && <p className="text-xs text-rose-400">{error}</p>}
        {report && (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label="جمع بدهکار (ریال)" value={formatNumber(report.totals.debit)} />
              <Stat label="جمع بستانکار (ریال)" value={formatNumber(report.totals.credit)} />
              <Stat label="اختلاف" value={formatNumber(report.totals.difference)} />
            </div>
            <ul className="flex flex-col gap-2">
              {report.tables.map((t) => (
                <li key={t.name} className="rounded-xl border border-border/60 p-3">
                  <p className="font-bold">
                    {t.name}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      → {packageEntityLabel(t.entity)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(t.rowCount)} ردیف · {formatNumber(t.validRows)} معتبر ·{" "}
                    {formatNumber(t.invalidRows)} نامعتبر · {formatNumber(t.duplicateRowsInFile)} تکراری
                    در فایل · {formatNumber(t.unmappedColumns.length)} ستون بی‌نگاشت
                  </p>
                  {t.unmappedColumns.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      بی‌نگاشت: {t.unmappedColumns.join("، ")}
                    </p>
                  )}
                  {t.totals && (
                    <p className="mt-1 text-xs">
                      بدهکار {formatNumber(t.totals.debit)} · بستانکار {formatNumber(t.totals.credit)} ·
                      اختلاف {formatNumber(t.totals.difference)}
                      {t.unbalancedVouchers ? ` · ${formatNumber(t.unbalancedVouchers)} سند نامتراز` : ""}
                    </p>
                  )}
                  {t.unbalancedSample && t.unbalancedSample.length > 0 && (
                    <p className="mt-1 text-xs text-rose-400">
                      نمونه سند نامتراز:{" "}
                      {t.unbalancedSample.map((s) => `${s.voucher} (${formatNumber(s.difference)})`).join("، ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {report.blockersFa.map((b) => (
              <p key={b} className="text-xs text-rose-400">
                ⛔ {b}
              </p>
            ))}
            {report.warningsFa.map((w) => (
              <p key={w} className="text-xs text-amber-400">
                ⚠ {w}
              </p>
            ))}
            {!report.balanced && (
              <label className="flex items-start gap-2 text-xs text-rose-300">
                <input
                  type="checkbox"
                  checked={confirmImbalance}
                  onChange={(e) => onConfirmImbalance(e.target.checked)}
                  className="mt-0.5 size-4 accent-rose-500"
                />
                <span>
                  (فقط مدیر یا مالک سازمان) عدم‌تراز را می‌پذیرم و ادامه می‌دهم. توجه: دفتر کل
                  اسناد نامتراز را نمی‌پذیرد؛ این گزینه فقط اجازه می‌دهد بقیهٔ اسناد تراز ثبت
                  شوند و اسناد نامتراز با خطا گزارش می‌شوند. کل ورود با یک دسته قابل بازگردانی است.
                </span>
              </label>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-bold" dir="ltr">
        {value}
      </p>
    </div>
  );
}
