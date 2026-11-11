"use client";

import { Printer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { integerToPersianWords } from "@/lib/persian-words";
import { printReceiptPaymentVoucher } from "@/lib/print/open-receipt-payment-voucher-window";
import { formatMethodDetail } from "@/lib/print/receipt-payment-voucher";
import { getDefaultPrintTemplate } from "@/lib/api/print-templates-client";
import { PrintDocType, PrintPaperSize } from "@/types/print-template";
import {
  TREASURY_KIND_LABELS,
  TREASURY_METHOD_LABELS,
  TREASURY_PARTY_LABELS,
  type TreasuryDocumentDetail,
} from "@/types/treasury";

/** Standalone button for printing a receipt/payment voucher. */
export function ReceiptPaymentPrintButton({
  doc,
  companyName = "",
  size = "sm",
  variant = "outline",
  className,
}: {
  doc: TreasuryDocumentDetail;
  companyName?: string;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost";
  className?: string;
}) {
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={async () => {
        try {
          const tpl = await getDefaultPrintTemplate(
            PrintDocType.RECEIPT_PAYMENT_VOUCHER,
            PrintPaperSize.A5,
          );
          printReceiptPaymentVoucher(doc, companyName, tpl);
        } catch {
          printReceiptPaymentVoucher(doc, companyName);
        }
      }}
    >
      <Printer className="size-4 ml-1.5" />
      چاپ رسید
    </Button>
  );
}

/**
 * Slide-out drawer displaying receipt/payment voucher details and a print action
 * mapped to the A5 print template.
 */
export function ReceiptPaymentVoucherDrawer({
  doc,
  open,
  onClose,
  companyName = "",
}: {
  doc: TreasuryDocumentDetail | null;
  open: boolean;
  onClose: () => void;
  companyName?: string;
}) {
  if (!doc) return null;

  const isReceipt = doc.kind === "receipt";
  const title = TREASURY_KIND_LABELS[doc.kind] ?? (isReceipt ? "رسید دریافت" : "رسید پرداخت");
  const partyLabel = TREASURY_PARTY_LABELS[doc.kind] ?? (isReceipt ? "دریافت از" : "پرداخت به");
  const totalBigInt = BigInt(String(doc.total).split(".")[0] || "0");

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="lg"
      title={`${title} ${doc.docNumber}`}
      description={`جزئیات سند خزانه‌داری مورخ ${formatJalaliDate(doc.docDate)}`}
    >
      <div className="space-y-6 p-4">
        {/* Top actions & Status */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b">
          <div className="flex items-center gap-2">
            <Badge variant={doc.status === "posted" ? "default" : "secondary"}>
              {doc.status === "posted" ? "ثبت نهایی" : "پیش‌نویس"}
            </Badge>
            {doc.journalEntryId && (
              <span className="text-xs text-muted-foreground font-mono">
                سند حسابداری: {doc.journalEntryId}
              </span>
            )}
          </div>

          <ReceiptPaymentPrintButton doc={doc} companyName={companyName} />
        </div>

        {/* Voucher Meta Card */}
        <div className="grid gap-3 sm:grid-cols-2 rounded-lg border bg-muted/20 p-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">{partyLabel}</span>
            <span className="font-semibold">{doc.partyName}</span>{" "}
            <span className="text-xs text-muted-foreground font-mono">({doc.partyCode})</span>
          </div>

          <div>
            <span className="text-xs text-muted-foreground block">مبلغ کل رسید</span>
            <span className="font-bold text-base text-primary">
              {formatMoneyRial(totalBigInt.toString())}
            </span>
            <span className="text-xs text-muted-foreground block mt-0.5">
              به حروف: {integerToPersianWords(totalBigInt)} ریال
            </span>
          </div>

          <div>
            <span className="text-xs text-muted-foreground block">تاریخ سند</span>
            <span>{formatJalaliDate(doc.docDate)}</span>
          </div>

          <div>
            <span className="text-xs text-muted-foreground block">بابت / شرح</span>
            <span>{doc.description || (isReceipt ? "تسویه حساب و دریافت وجه" : "تسویه حساب و پرداخت وجه")}</span>
          </div>
        </div>

        {/* Payment Methods Section */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">روش‌های پرداخت / دریافت</h3>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-32">روش</TableHead>
                  <TableHead>جزئیات (بانک، پیگیری، چک)</TableHead>
                  <TableHead className="text-left w-36">مبلغ (ریال)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doc.methods.map((methodLine) => (
                  <TableRow key={methodLine.id}>
                    <TableCell className="font-medium">
                      {TREASURY_METHOD_LABELS[methodLine.method] ?? methodLine.method}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatMethodDetail(methodLine)}
                    </TableCell>
                    <TableCell className="text-left tabular-nums">
                      {formatMoneyRial(String(methodLine.amount).split(".")[0] || "0")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Invoices Allocation Section */}
        {doc.allocations && doc.allocations.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">تخصیص به فاکتورها</h3>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>شماره فاکتور</TableHead>
                    <TableHead>تاریخ تخصیص</TableHead>
                    <TableHead className="text-left">مبلغ تخصیص (ریال)</TableHead>
                    <TableHead className="text-left">تخفیف / بخشودگی</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doc.allocations.map((alloc) => (
                    <TableRow key={alloc.id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {alloc.invoiceNumber ?? alloc.invoiceId}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatJalaliDate(alloc.allocatedDate)}
                      </TableCell>
                      <TableCell className="text-left tabular-nums">
                        {formatMoneyRial(String(alloc.amount).split(".")[0] || "0")}
                      </TableCell>
                      <TableCell className="text-left tabular-nums text-xs text-muted-foreground">
                        {alloc.writeoff ? formatMoneyRial(String(alloc.writeoff).split(".")[0] || "0") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="flex items-center justify-between pt-4 border-t text-xs text-muted-foreground">
          <span>سایز کاغذ استاندارد چاپ: A5 افقی</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            بستن
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
