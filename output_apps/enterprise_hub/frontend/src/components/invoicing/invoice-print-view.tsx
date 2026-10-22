"use client";

import { CheckCircle2, Pencil, Printer, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatJalaliDate,
  formatMoneyRial,
  formatNumber,
} from "@/lib/fa-format";
import {
  INVOICE_STATUS_LABELS,
  InvoiceStatus,
  VAT_RATE,
  type InvoiceResponseDto,
} from "@/types/invoicing";

interface InvoicePrintViewProps {
  invoice: InvoiceResponseDto;
  onClose: () => void;
  onPay?: (invoice: InvoiceResponseDto) => void;
  onEdit?: (invoice: InvoiceResponseDto) => void;
}

function statusLabel(status: InvoiceStatus): string {
  return INVOICE_STATUS_LABELS[status];
}

/**
 * نمای چاپی صورتحساب با قالب A4 و راست‌به‌چپ. دکمه‌ها در چاپ پنهان می‌شوند
 * و فقط برگه صورتحساب روی کاغذ می‌آید.
 */
export function InvoicePrintView({
  invoice,
  onClose,
  onPay,
  onEdit,
}: InvoicePrintViewProps) {
  const canPay =
    invoice.status === InvoiceStatus.DRAFT ||
    invoice.status === InvoiceStatus.ISSUED;
  const canEdit =
    invoice.status === InvoiceStatus.DRAFT ||
    invoice.status === InvoiceStatus.ISSUED;

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/70 p-4 print:static print:bg-white print:p-0">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-print-sheet, #invoice-print-sheet * { visibility: visible !important; }
          #invoice-print-sheet {
            position: absolute;
            inset: 0;
            box-shadow: none !important;
            border: none !important;
          }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>

      <div className="mx-auto flex max-w-[210mm] flex-col gap-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-white">
            <span className="font-bold">نمای صورتحساب</span>
            <Badge variant="secondary">{statusLabel(invoice.status)}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && onEdit && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onEdit(invoice)}
              >
                <Pencil />
                ویرایش
              </Button>
            )}
            {canPay && onPay && (
              <Button
                variant="default"
                size="sm"
                onClick={() => onPay(invoice)}
              >
                <CheckCircle2 />
                ثبت پرداخت
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.print()}
            >
              <Printer />
              چاپ
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>
              <X />
              بستن
            </Button>
          </div>
        </div>
      </div>

      <div
        id="invoice-print-sheet"
        dir="rtl"
        className="mx-auto mt-4 w-full max-w-[210mm] bg-white p-[12mm] text-black shadow-2xl print:mt-0 print:max-w-none print:p-0"
      >
        <header className="flex items-start justify-between gap-4 border-b border-black/20 pb-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-black">صورتحساب فروش</h1>
            <span className="font-mono text-sm">{invoice.taxInvoiceNumber}</span>
            <span className="text-xs text-black/60">
              تاریخ ثبت: {formatJalaliDate(invoice.createdAt)}
            </span>
            {invoice.issuedAt && (
              <span className="text-xs text-black/60">
                تاریخ صدور: {formatJalaliDate(invoice.issuedAt)}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 text-left">
            <span className="rounded-md border border-black/20 px-3 py-1 text-xs font-bold">
              {statusLabel(invoice.status)}
            </span>
            <span className="font-mono text-xs text-black/60">
              {invoice.currency}
            </span>
            {invoice.paidAt && (
              <span className="text-xs text-emerald-700">
                پرداخت‌شده در {formatJalaliDate(invoice.paidAt)}
              </span>
            )}
          </div>
        </header>

        <section className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-md border border-black/15 p-3 text-sm">
            <h2 className="mb-1 text-xs font-bold text-black/60">فروشنده</h2>
            <span className="font-bold">{invoice.sellerInfo?.name ?? "—"}</span>
            {invoice.sellerInfo?.nationalId && (
              <span>شناسه: {invoice.sellerInfo.nationalId}</span>
            )}
            {invoice.sellerInfo?.economicCode && (
              <span>کد اقتصادی: {invoice.sellerInfo.economicCode}</span>
            )}
            {invoice.sellerInfo?.address && (
              <span className="text-xs text-black/70">
                {invoice.sellerInfo.address}
              </span>
            )}
            {invoice.sellerInfo?.phone && (
              <span className="font-mono text-xs" dir="ltr">
                {invoice.sellerInfo.phone}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1 rounded-md border border-black/15 p-3 text-sm">
            <h2 className="mb-1 text-xs font-bold text-black/60">خریدار</h2>
            <span className="font-bold">{invoice.buyerInfo?.name ?? "—"}</span>
            {invoice.buyerInfo?.nationalId && (
              <span>شناسه: {invoice.buyerInfo.nationalId}</span>
            )}
            {invoice.buyerInfo?.economicCode && (
              <span>کد اقتصادی: {invoice.buyerInfo.economicCode}</span>
            )}
            {invoice.buyerInfo?.address && (
              <span className="text-xs text-black/70">
                {invoice.buyerInfo.address}
              </span>
            )}
            {invoice.buyerInfo?.phone && (
              <span className="font-mono text-xs" dir="ltr">
                {invoice.buyerInfo.phone}
              </span>
            )}
            {invoice.buyerInfo?.email && (
              <span className="font-mono text-xs" dir="ltr">
                {invoice.buyerInfo.email}
              </span>
            )}
          </div>
        </section>

        <table className="mt-5 w-full border-collapse text-xs">
          <thead>
            <tr className="bg-black/[0.06]">
              <th className="border border-black/20 px-2 py-2 text-right">#</th>
              <th className="border border-black/20 px-2 py-2 text-right">شرح</th>
              <th className="border border-black/20 px-2 py-2 text-left">تعداد</th>
              <th className="border border-black/20 px-2 py-2 text-left">
                قیمت واحد
              </th>
              <th className="border border-black/20 px-2 py-2 text-left">تخفیف</th>
              <th className="border border-black/20 px-2 py-2 text-left">
                نرخ VAT
              </th>
              <th className="border border-black/20 px-2 py-2 text-left">مالیات</th>
              <th className="border border-black/20 px-2 py-2 text-left">جمع</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, index) => {
              const rate =
                item.vatRate !== undefined ? item.vatRate : VAT_RATE;
              return (
                <tr key={`${item.description}-${index}`}>
                  <td className="border border-black/20 px-2 py-2">
                    {formatNumber(index + 1)}
                  </td>
                  <td className="border border-black/20 px-2 py-2">
                    {item.description}
                    {item.sku ? (
                      <span className="mr-1 font-mono text-[10px] text-black/50">
                        ({item.sku})
                      </span>
                    ) : null}
                  </td>
                  <td className="border border-black/20 px-2 py-2 text-left">
                    {formatNumber(item.quantity)}
                  </td>
                  <td className="border border-black/20 px-2 py-2 text-left">
                    {formatMoneyRial(item.unitPrice)}
                  </td>
                  <td className="border border-black/20 px-2 py-2 text-left">
                    {formatMoneyRial(item.discount)}
                  </td>
                  <td className="border border-black/20 px-2 py-2 text-left">
                    {formatNumber(rate * 100)}٪
                  </td>
                  <td className="border border-black/20 px-2 py-2 text-left">
                    {formatMoneyRial(item.tax)}
                  </td>
                  <td className="border border-black/20 px-2 py-2 text-left font-bold">
                    {formatMoneyRial(item.total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <section className="mt-4 flex justify-start">
          <div className="w-full max-w-sm text-sm">
            <div className="flex items-center justify-between border-b border-black/15 py-1.5">
              <span className="text-black/60">جمع ناخالص</span>
              <span>{formatMoneyRial(invoice.totalAmount)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-black/15 py-1.5">
              <span className="text-black/60">جمع تخفیف</span>
              <span>{formatMoneyRial(invoice.totalDiscount)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-black/15 py-1.5">
              <span className="text-black/60">جمع مالیات ارزش افزوده</span>
              <span>{formatMoneyRial(invoice.totalTax)}</span>
            </div>
            <div className="flex items-center justify-between py-2 text-base font-black">
              <span>مبلغ قابل پرداخت</span>
              <span>{formatMoneyRial(invoice.finalPayable)}</span>
            </div>
          </div>
        </section>

        <footer className="mt-8 flex items-end justify-between gap-6 text-xs text-black/60">
          <span>
            این صورتحساب به‌صورت الکترونیک صادر شده و بدون مهر و امضا نیز معتبر
            است.
          </span>
          <span className="min-w-32 border-t border-black/30 pt-1 text-center">
            مهر و امضای فروشنده
          </span>
        </footer>
      </div>
    </div>
  );
}
