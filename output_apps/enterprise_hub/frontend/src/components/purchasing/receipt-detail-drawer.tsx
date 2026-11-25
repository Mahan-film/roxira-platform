"use client";

import { DollarSign, Truck } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinorMoney, formatQuantity, formatWeight } from "./purchasing-format";
import { formatJalaliDate } from "@/lib/fa-format";
import type { GoodsReceipt } from "@/types/purchasing";

interface ReceiptDetailDrawerProps {
  receipt: GoodsReceipt | null;
  open: boolean;
  canPost?: boolean;
  onClose: () => void;
  onOpenLandedCost: (receipt: GoodsReceipt) => void;
}

export function ReceiptDetailDrawer({
  receipt,
  open,
  canPost = true,
  onClose,
  onOpenLandedCost,
}: ReceiptDetailDrawerProps) {
  if (!receipt) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`رسید انبار ${receipt.number}`}
      description={`تأمین‌کننده: ${receipt.supplierCode} | تاریخ ثبت: ${formatJalaliDate(receipt.receivedAt)}`}
      size="xl"
    >
      <div className="flex flex-col gap-6" data-testid="receipt-detail-view">
        {/* Metadata summary */}
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-border p-4 bg-muted/20 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">شماره سفارش مربوطه</p>
            <p className="mt-1 text-sm font-semibold text-foreground truncate" title={receipt.orderId}>
              {receipt.orderId.slice(0, 8)}...
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">تحویل‌گیرنده</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{receipt.receivedBy}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">ارزش کل رسید</p>
            <p className="mt-1 text-sm font-bold text-foreground text-emerald-600">
              {formatMinorMoney(receipt.totalValue)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">سند حسابداری ورود به انبار</p>
            <div className="mt-1">
              {receipt.journalEntryId ? (
                <Badge variant="outline" className="text-xs text-indigo-600 border-indigo-200">
                  {receipt.journalEntryId.slice(0, 8)}...
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </div>
        </div>

        {/* Action button */}
        {canPost && (
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => {
                onClose();
                onOpenLandedCost(receipt);
              }}
              className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <DollarSign className="size-4" />
              تخصیص هزینه سربار خرید (Landed Cost)
            </Button>
          </div>
        )}

        {/* Lines table */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">اقلام رسیدشده</h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">کد کالا (SKU)</TableHead>
                  <TableHead className="text-center">مقدار دریافتی</TableHead>
                  <TableHead className="text-center">بهای تمام‌شده واحد</TableHead>
                  <TableHead className="text-left">ارزش کل سطر</TableHead>
                  <TableHead className="text-center">وزن</TableHead>
                  <TableHead className="text-center">بچ FIFO</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipt.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">{line.sku}</TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatQuantity(line.quantity)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {formatMinorMoney(line.unitCost)}
                    </TableCell>
                    <TableCell className="text-left tabular-nums font-semibold">
                      {formatMinorMoney(line.value)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums text-xs text-muted-foreground">
                      {formatWeight(line.weight)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums text-xs">
                      {line.fifoBatchId ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
