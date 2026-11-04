"use client";

import Link from "next/link";
import { Ban, CheckCircle2, Eye, FileClock, Send, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RowActionsMenu, type RowAction } from "@/components/ui/row-actions-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatGregorianDate,
  formatJalaliDate,
  formatLatinMoney,
  formatMoneyRial,
  formatNumber,
} from "@/lib/fa-format";
import {
  invoiceOutstanding,
  invoiceParty,
  selectionTotal,
  type RialRow,
} from "@/lib/invoice-list";
import {
  INVOICE_STATUS_LABELS,
  INVOICE_SUBJECT_LABELS,
  InvoiceStatus,
  InvoiceSubject,
  invoiceRialEquivalent,
  isForeignInvoice,
  type InvoiceResponseDto,
} from "@/types/invoicing";

/** Word + icon per status; -800 text on a -50 fill keeps AA contrast, colour is never alone. */
const STATUS_STYLE: Record<InvoiceStatus, { icon: LucideIcon; className: string }> = {
  [InvoiceStatus.DRAFT]: { icon: FileClock, className: "bg-muted text-foreground" },
  [InvoiceStatus.ISSUED]: {
    icon: Send,
    className: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  },
  [InvoiceStatus.PAID]: {
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  },
  [InvoiceStatus.CANCELLED]: {
    icon: Ban,
    className: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
  },
};

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const { icon: Icon, className } = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${className}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {INVOICE_STATUS_LABELS[status]}
    </span>
  );
}

export interface InvoiceListActions {
  onView: (invoice: InvoiceResponseDto) => void;
  onEdit: (invoice: InvoiceResponseDto) => void;
  onPay: (invoice: InvoiceResponseDto) => void;
  onCancel: (invoice: InvoiceResponseDto) => void;
  onRelated: (invoice: InvoiceResponseDto, subject: InvoiceSubject) => void;
}

interface InvoiceListTableProps extends InvoiceListActions {
  invoices: InvoiceResponseDto[];
  loading: boolean;
  busyId: string | null;
  selected: ReadonlySet<string>;
  onToggle: (id: string | null) => void;
}

function rialRow(invoice: InvoiceResponseDto): RialRow {
  const foreign = isForeignInvoice(invoice);
  return {
    id: invoice.id,
    status: invoice.status,
    rialAmount: foreign ? Math.round(invoiceRialEquivalent(invoice)) : invoice.finalPayable,
  };
}

function rowActions(invoice: InvoiceResponseDto, busy: boolean, actions: InvoiceListActions): RowAction[] {
  const open = invoice.status !== InvoiceStatus.PAID && invoice.status !== InvoiceStatus.CANCELLED;
  const related =
    (invoice.status === InvoiceStatus.ISSUED || invoice.status === InvoiceStatus.PAID) &&
    invoice.subject === InvoiceSubject.ORIGINAL;
  const list: RowAction[] = [];
  if (open) {
    list.push(
      { label: "ثبت پرداخت", onSelect: () => actions.onPay(invoice), disabled: busy },
      { label: "ویرایش", onSelect: () => actions.onEdit(invoice), disabled: busy },
    );
  }
  if (related) {
    list.push(
      { label: "صورتحساب اصلاحی", onSelect: () => actions.onRelated(invoice, InvoiceSubject.CORRECTIVE) },
      { label: "برگشت کالا", onSelect: () => actions.onRelated(invoice, InvoiceSubject.RETURN) },
      { label: "صدور سند ابطالی", onSelect: () => actions.onRelated(invoice, InvoiceSubject.CANCEL) },
    );
  }
  if (open) {
    list.push({ label: "ابطال", onSelect: () => actions.onCancel(invoice), disabled: busy });
  }
  return list;
}

/** Persian digits for an identifier, keeping leading zeros and no grouping. */
const faDigits = (text: string) => text.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

function PartyCell({ invoice }: { invoice: InvoiceResponseDto }) {
  const party = invoiceParty(invoice);
  if (!party.name) {
    return <span className="text-muted-foreground">{party.hint ? faDigits(party.hint) : "نام ثبت نشده"}</span>;
  }
  return party.href ? (
    <Link href={party.href} className="font-medium text-primary underline-offset-4 hover:underline">
      {party.name}
    </Link>
  ) : (
    <span className="font-medium">{party.name}</span>
  );
}

function Amount({ invoice, row }: { invoice: InvoiceResponseDto; row: RialRow }) {
  return (
    <span className="tabular-nums">
      {formatMoneyRial(row.rialAmount)}
      {isForeignInvoice(invoice) && (
        <span className="block text-xs text-muted-foreground" dir="ltr">
          {formatLatinMoney(invoice.finalPayable, invoice.currency)}
        </span>
      )}
    </span>
  );
}

function InvoiceDate({ invoice }: { invoice: InvoiceResponseDto }) {
  const date = invoice.issuedAt ?? invoice.createdAt;
  return <span title={formatGregorianDate(date)}>{formatJalaliDate(date)}</span>;
}

function Outstanding({ row }: { row: RialRow }) {
  const value = invoiceOutstanding(row);
  return <span className="tabular-nums">{value === null ? "—" : formatMoneyRial(value)}</span>;
}

function Checkbox({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="size-4 accent-primary"
    />
  );
}

export function InvoiceListTable({ invoices, loading, busyId, selected, onToggle, ...actions }: InvoiceListTableProps) {
  const rows = new Map(invoices.map((invoice) => [invoice.id, rialRow(invoice)]));
  const allSelected = invoices.length > 0 && invoices.every((invoice) => selected.has(invoice.id));
  const picked = selectionTotal([...rows.values()], selected);

  if (invoices.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {loading ? "در حال بارگذاری..." : "صورتحسابی با این فیلتر یافت نشد."}
      </p>
    );
  }

  const menu = (invoice: InvoiceResponseDto) => {
    const list = rowActions(invoice, busyId === invoice.id, actions);
    return list.length > 0 ? (
      <RowActionsMenu label={`عملیات صورتحساب ${invoice.taxInvoiceNumber}`} actions={list} />
    ) : null;
  };

  return (
    <>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={allSelected} label="انتخاب همه" onChange={() => onToggle(null)} />
              </TableHead>
              <TableHead>شماره</TableHead>
              <TableHead>طرف حساب</TableHead>
              <TableHead>تاریخ</TableHead>
              <TableHead>مبلغ کل</TableHead>
              <TableHead>مانده</TableHead>
              <TableHead>وضعیت</TableHead>
              <TableHead className="w-28">
                <span className="sr-only">عملیات</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => {
              const row = rows.get(invoice.id)!;
              return (
                <TableRow key={invoice.id} data-state={selected.has(invoice.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(invoice.id)}
                      label={`انتخاب ${invoice.taxInvoiceNumber}`}
                      onChange={() => onToggle(invoice.id)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {invoice.taxInvoiceNumber}
                    {invoice.subject !== InvoiceSubject.ORIGINAL && (
                      <span className="block font-sans text-muted-foreground">
                        {INVOICE_SUBJECT_LABELS[invoice.subject]}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <PartyCell invoice={invoice} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <InvoiceDate invoice={invoice} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Amount invoice={invoice} row={row} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Outstanding row={row} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={invoice.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => actions.onView(invoice)}>
                        <Eye />
                        مشاهده
                      </Button>
                      {menu(invoice)}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col divide-y divide-border sm:hidden">
        {invoices.map((invoice) => {
          const row = rows.get(invoice.id)!;
          return (
            <li key={invoice.id} className="flex items-start gap-3 p-3">
              <span className="flex min-h-11 items-center">
                <Checkbox
                  checked={selected.has(invoice.id)}
                  label={`انتخاب ${invoice.taxInvoiceNumber}`}
                  onChange={() => onToggle(invoice.id)}
                />
              </span>
              <button
                type="button"
                onClick={() => actions.onView(invoice)}
                className="flex min-h-11 flex-1 flex-col items-start gap-1 text-start"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="font-mono text-xs">{invoice.taxInvoiceNumber}</span>
                  <StatusBadge status={invoice.status} />
                </span>
                <span className="text-sm font-medium">{invoiceParty(invoice).name ?? "نام ثبت نشده"}</span>
                <span className="flex w-full items-center justify-between gap-2 text-sm">
                  <InvoiceDate invoice={invoice} />
                  <Amount invoice={invoice} row={row} />
                </span>
              </button>
              <span className="flex min-h-11 items-center">{menu(invoice)}</span>
            </li>
          );
        })}
      </ul>

      {picked.count > 0 && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 p-3 text-sm"
        >
          <span>{formatNumber(picked.count)} صورتحساب انتخاب شد</span>
          <span className="font-medium tabular-nums">جمع: {formatMoneyRial(picked.total)}</span>
        </div>
      )}
    </>
  );
}
