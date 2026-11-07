"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listCheques } from "@/lib/api/cheques-client";
import { listInvoices } from "@/lib/api/invoicing-client";
import {
  PARTY_TAB_LABELS,
  PARTY_TAB_ORDER,
  type PartyTab,
  partyOpenBalance,
  partyReceivedCheques,
  partyReceipts,
  partySaleInvoices,
} from "@/lib/customer-party";
import { formatAmount, formatMoneyRial, formatJalaliDate } from "@/lib/fa-format";
import { STATUS_LABELS, type Cheque } from "@/types/cheques";
import type { Lead } from "@/types/crm";
import { INVOICE_STATUS_LABELS, type InvoiceResponseDto } from "@/types/invoicing";

/** How many recent invoices are scanned for this customer (one API page). */
const INVOICE_SCAN_LIMIT = 100;

interface PartyData {
  leadId: number;
  invoices: InvoiceResponseDto[];
  invoicesTotal: number;
  cheques: Cheque[];
  error: string | null;
}

/**
 * Tabs «فاکتورها · دریافت‌ها · مانده · چک‌ها» inside the customer drawer, filtered to one party.
 * Data: invoices (customerId = lead id) and received cheques (name match); see lib/customer-party.ts.
 */
export function CustomerPartyTabs({ lead }: { lead: Lead }) {
  const [tab, setTab] = useState<PartyTab>("invoices");
  const [data, setData] = useState<PartyData | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listInvoices({ limit: INVOICE_SCAN_LIMIT }, controller.signal),
      listCheques({ direction: "received" }, controller.signal),
    ]).then(
      ([invoices, cheques]) =>
        setData({
          leadId: lead.id,
          invoices: invoices.data,
          invoicesTotal: invoices.total,
          cheques,
          error: null,
        }),
      (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setData({
          leadId: lead.id,
          invoices: [],
          invoicesTotal: 0,
          cheques: [],
          error: "اطلاعات این مشتری بارگذاری نشد. لطفاً دوباره تلاش کنید.",
        });
      },
    );
    return () => controller.abort();
  }, [lead.id]);

  const loaded = data?.leadId === lead.id ? data : null;

  return (
    <section aria-label="اطلاعات مشتری" className="flex flex-col gap-3 px-4 pb-2">
      <div role="tablist" aria-label="بخش‌های مشتری" className="flex flex-wrap gap-2">
        {PARTY_TAB_ORDER.map((key) => (
          <Button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            size="sm"
            variant={tab === key ? "default" : "outline"}
            onClick={() => setTab(key)}
          >
            {PARTY_TAB_LABELS[key]}
          </Button>
        ))}
      </div>
      {!loaded ? (
        <p className="text-sm text-muted-foreground" role="status">
          در حال بارگذاری…
        </p>
      ) : loaded.error ? (
        <p className="text-sm text-destructive" role="alert">
          {loaded.error}
        </p>
      ) : (
        <PartyTabBody tab={tab} lead={lead} data={loaded} />
      )}
    </section>
  );
}

function PartyTabBody({ tab, lead, data }: { tab: PartyTab; lead: Lead; data: PartyData }) {
  const sales = partySaleInvoices(data.invoices, lead.id);
  const truncated = data.invoicesTotal > data.invoices.length;
  const note = truncated ? (
    <p className="text-xs text-muted-foreground">
      فقط {data.invoices.length} فاکتور آخر بررسی شد؛ ممکن است فاکتورهای قدیمی‌تر این مشتری نمایش داده نشوند.
    </p>
  ) : null;

  if (tab === "invoices") {
    return (
      <>
        {note}
        {sales.length === 0 ? (
          <EmptyLine text="فاکتور فروشی برای این مشتری ثبت نشده است." />
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {sales.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span className="flex flex-col">
                  <span dir="ltr" className="font-medium">{inv.taxInvoiceNumber}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatJalaliDate(inv.issuedAt ?? inv.createdAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span>{formatMoneyRial(inv.finalPayable)}</span>
                  <Badge variant="outline">{INVOICE_STATUS_LABELS[inv.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  if (tab === "receipts") {
    const receipts = partyReceipts(sales);
    return (
      <>
        {note}
        {receipts.length === 0 ? (
          <EmptyLine text="دریافتی از این مشتری ثبت نشده است." />
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {receipts.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span className="flex flex-col">
                  <span dir="ltr" className="font-medium">{inv.taxInvoiceNumber}</span>
                  <span className="text-xs text-muted-foreground">{formatJalaliDate(inv.paidAt)}</span>
                </span>
                <span>{formatMoneyRial(inv.finalPayable)}</span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  if (tab === "balance") {
    const { total, count } = partyOpenBalance(sales);
    return (
      <>
        {note}
        <div className="flex flex-col gap-1 rounded-md border p-3">
          <span className="text-xs text-muted-foreground">مانده بدهی از فاکتورهای صادرشده</span>
          <span className="text-lg font-semibold">{formatMoneyRial(total)}</span>
          <span className="text-xs text-muted-foreground">{count} فاکتور پرداخت‌نشده</span>
        </div>
      </>
    );
  }

  const cheques = partyReceivedCheques(data.cheques, lead);
  return (
    <>
      {cheques.length === 0 ? (
        <EmptyLine text="چک دریافتی از این مشتری ثبت نشده است." />
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {cheques.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span className="flex flex-col">
                <span dir="ltr" className="font-medium">{c.chequeNumber}</span>
                <span className="text-xs text-muted-foreground">سررسید {formatJalaliDate(c.dueDate)}</span>
              </span>
              <span className="flex items-center gap-2">
                <span>{formatAmount(c.amount)}</span>
                <Badge variant="outline">{STATUS_LABELS.received[c.status]}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{text}</p>;
}
