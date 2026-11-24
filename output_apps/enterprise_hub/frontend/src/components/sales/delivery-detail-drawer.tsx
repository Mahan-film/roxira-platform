"use client";

import { Drawer } from "@/components/ui/drawer";
import { Label } from "@/components/ui/label";
import { formatSalesMoney, formatSalesQuantity } from "./sales-format";
import type { SalesDelivery } from "@/types/sales";

interface DeliveryDetailDrawerProps {
  delivery: SalesDelivery | null;
  open: boolean;
  onClose: () => void;
}

export function DeliveryDetailDrawer({
  delivery,
  open,
  onClose,
}: DeliveryDetailDrawerProps) {
  if (!delivery) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`حواله خروج فروش: ${delivery.number}`}
      description="جزئیات اقلام حواله خروج، بهای تمام‌شده و اسناد انبار/حسابداری متناظر"
      size="xl"
    >
      <div className="flex flex-col gap-6" data-testid="delivery-detail-view">
        {/* Top Info Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-lg border border-border p-4 bg-muted/20">
          <div>
            <div className="text-xs text-muted-foreground">کد مشتری / طرف‌حساب</div>
            <div className="font-semibold">{delivery.partyCode}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">تاریخ تحویل</div>
            <div className="font-semibold">{delivery.deliveryDate}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">شناسه انبار</div>
            <div className="font-semibold">{delivery.warehouseId}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">بهای تمام‌شده کل</div>
            <div className="font-semibold text-primary">
              {formatSalesMoney(delivery.totalCost)}
            </div>
          </div>
        </div>

        {/* References info */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border p-3 text-xs bg-background">
            <span className="font-medium text-muted-foreground">سفارش فروش متناظر: </span>
            <span className="font-semibold">{delivery.orderId}</span>
          </div>
          <div className="rounded-md border border-border p-3 text-xs bg-background">
            <span className="font-medium text-muted-foreground">سند خروج انبار: </span>
            <span className="font-semibold">
              {delivery.stockDocumentId ? `#${delivery.stockDocumentId}` : "ثبت نشده"}
            </span>
          </div>
          <div className="rounded-md border border-border p-3 text-xs bg-background">
            <span className="font-medium text-muted-foreground">سند حسابداری (بهای تمام‌شده): </span>
            <span className="font-semibold">
              {delivery.journalEntryId ? `#${delivery.journalEntryId}` : "ثبت نشده"}
            </span>
          </div>
        </div>

        {/* Lines Table */}
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-semibold">اقلام تحویل داده‌شده</Label>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-right text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-center">ردیف</th>
                  <th className="px-3 py-2">شناسه کالا / SKU</th>
                  <th className="px-3 py-2 text-center">مقدار</th>
                  <th className="px-3 py-2">بهای تمام‌شده واحد (ریال)</th>
                  <th className="px-3 py-2">بهای تمام‌شده کل (ریال)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {delivery.lines && delivery.lines.length > 0 ? (
                  delivery.lines.map((l) => (
                    <tr key={l.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2.5 text-center text-muted-foreground">{l.lineNo}</td>
                      <td className="px-3 py-2.5 font-medium">
                        {l.sku || `کالا #${l.itemId}`}
                      </td>
                      <td className="px-3 py-2.5 text-center font-medium">
                        {formatSalesQuantity(l.quantity)}
                      </td>
                      <td className="px-3 py-2.5">{formatSalesMoney(l.unitCost)}</td>
                      <td className="px-3 py-2.5 font-semibold text-primary">
                        {formatSalesMoney(l.lineCost)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                      سطری ثبت نشده است.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
