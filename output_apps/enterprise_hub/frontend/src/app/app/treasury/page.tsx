"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  Check,
  ChevronDown,
  CreditCard,
  FileText,
  Landmark,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Wallet,
} from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReceiptPaymentVoucherDrawer } from "@/components/treasury/receipt-payment-voucher-drawer";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { listBankAccounts, listCashBoxes } from "@/lib/api/banking-client";
import {
  createTreasuryDocument,
  getOpenInvoices,
  getTreasuryDocument,
  listTreasuryDocuments,
} from "@/lib/api/treasury-client";
import type { BankAccount, CashBox } from "@/types/banking";
import {
  TREASURY_KIND_LABELS,
  TREASURY_METHOD_LABELS,
  TREASURY_PARTY_LABELS,
  TreasuryDocKind,
  TreasuryMethod,
  TreasuryPartyType,
  type CreateTreasuryDocumentDto,
  type OpenInvoice,
  type TreasuryDocument,
  type TreasuryDocumentDetail,
} from "@/types/treasury";

export default function TreasurySettlementPage() {
  const [documents, setDocuments] = useState<TreasuryDocument[]>([]);
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // View state: 'list' | 'create'
  const [mode, setMode] = useState<"list" | "create">("list");

  // Selected document for details drawer / print
  const [selectedDoc, setSelectedDoc] = useState<TreasuryDocumentDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  // Form states for creating a settlement document
  const [docKind, setDocKind] = useState<TreasuryDocKind>(TreasuryDocKind.RECEIPT);
  const [partyType, setPartyType] = useState<TreasuryPartyType>(TreasuryPartyType.CUSTOMER);
  const [partyCode, setPartyCode] = useState<string>("");
  const [partyName, setPartyName] = useState<string>("");
  const [docDate, setDocDate] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  // Open invoices for allocation
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [fetchingInvoices, setFetchingInvoices] = useState<boolean>(false);
  const [allocations, setAllocations] = useState<
    Record<string, { amount: string; writeoff: string }>
  >({});

  // Payment lines (methods: cash, bank, cheque)
  const [lines, setLines] = useState<
    Array<{
      method: TreasuryMethod;
      amount: string;
      bankAccountId?: number;
      cashBoxId?: number;
      reference?: string;
      chequeNumber?: string;
      bankName?: string;
      dueDate?: string;
    }>
  >([{ method: TreasuryMethod.BANK_TRANSFER, amount: "" }]);

  const [submitting, setSubmitting] = useState<boolean>(false);

  const loadDocs = () => {
    setLoading(true);
    setError(null);
    listTreasuryDocuments()
      .then((docs) => setDocuments(docs))
      .catch((err) => setError(err.message || "خطا در دریافت اسناد خزانه"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDocs();
    Promise.all([listCashBoxes(), listBankAccounts()]).then(([boxes, banks]) => {
      setCashBoxes(boxes);
      setBankAccounts(banks);
    }).catch(() => {});
  }, []);

  const handleDocKindChange = (kind: TreasuryDocKind) => {
    setDocKind(kind);
    setPartyType(
      kind === TreasuryDocKind.RECEIPT
        ? TreasuryPartyType.CUSTOMER
        : TreasuryPartyType.SUPPLIER,
    );
    setOpenInvoices([]);
    setAllocations({});
  };

  const handleFetchInvoices = () => {
    if (!partyCode) {
      setError("لطفاً ابتدا کد طرف‌حساب را وارد نمایید.");
      return;
    }
    setFetchingInvoices(true);
    setError(null);
    getOpenInvoices(docKind, undefined, partyCode)
      .then((invs) => {
        setOpenInvoices(invs);
        const map: Record<string, { amount: string; writeoff: string }> = {};
        for (const inv of invs) {
          map[inv.invoiceId] = { amount: "", writeoff: "0" };
        }
        setAllocations(map);
      })
      .catch((err) => setError(err.message || "خطا در دریافت فاکتورهای باز"))
      .finally(() => setFetchingInvoices(false));
  };

  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      { method: TreasuryMethod.CASH, amount: "" },
    ]);
  };

  const handleRemoveLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  // Compute totals
  const totalMethods = lines.reduce(
    (sum, l) => sum + (Number(l.amount) || 0),
    0,
  );
  const totalAllocated = Object.values(allocations).reduce(
    (sum, a) => sum + (Number(a.amount) || 0),
    0,
  );
  const totalWriteoff = Object.values(allocations).reduce(
    (sum, a) => sum + (Number(a.writeoff) || 0),
    0,
  );
  const advanceAmount = Math.max(0, totalMethods - totalAllocated);

  const handleSubmit = async () => {
    if (!partyCode || !docDate || lines.length === 0 || totalMethods <= 0) {
      setError("لطفاً طرف‌حساب، تاریخ و حداقل یک ردیف پرداخت معتبر وارد کنید.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const payload: CreateTreasuryDocumentDto = {
      kind: docKind,
      partyType,
      partyCode,
      partyName: partyName.trim() || partyCode,
      docDate,
      description: description || undefined,
      methods: lines
        .filter((l) => Number(l.amount) > 0)
        .map((l) => ({
          method: l.method,
          amount: Number(l.amount),
          bankAccountId: l.bankAccountId ? Number(l.bankAccountId) : undefined,
          cashBoxId: l.cashBoxId ? Number(l.cashBoxId) : undefined,
          reference: l.reference || undefined,
          chequeNumber: l.chequeNumber || undefined,
          bankName: l.bankName || undefined,
          chequeBankName: l.bankName || undefined,
          dueDate: l.dueDate || undefined,
        })),
      allocations: Object.entries(allocations)
        .filter(([_, a]) => Number(a.amount) > 0 || Number(a.writeoff) > 0)
        .map(([invId, a]) => ({
          invoiceId: invId,
          amount: Number(a.amount) || 0,
          writeoff: Number(a.writeoff) || 0,
        })),
    };

    try {
      const detail = await createTreasuryDocument(payload);
      setSuccessMsg(`سند خزانه شماره ${detail.docNumber} با موفقیت ثبت و تسویه شد.`);
      setMode("list");
      loadDocs();
      setSelectedDoc(detail);
      setDrawerOpen(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در ثبت سند تسویه");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenDetail = async (id: number) => {
    try {
      const detail = await getTreasuryDocument(id);
      setSelectedDoc(detail);
      setDrawerOpen(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در دریافت جزئیات سند");
    }
  };

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="خزانه‌داری و تسویه فاکتورها"
        description="ثبت دریافت‌ها و پرداخت‌های نقدی، حواله بانکی و چک، همراه با تخصیص مستقیم به فاکتورهای فروش و خرید"
        icon={<Receipt className="size-6 text-blue-600" />}
        actions={
          <div className="flex items-center gap-2">
            {mode === "list" ? (
              <Button size="sm" onClick={() => setMode("create")}>
                <Plus className="size-4 ml-1.5" />
                ثبت دریافت / پرداخت جدید
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setMode("list")}>
                <ArrowRight className="size-4 ml-1.5" />
                فهرست اسناد
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        {error && <ErrorNotice title="خطا در عملیات خزانه‌داری" message={error} />}
        {successMsg && (
          <div className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200">
            {successMsg}
          </div>
        )}
        <LoadingLine show={loading} />

        {mode === "list" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>اسناد دریافت و پرداخت خزانه‌داری ({documents.length})</span>
                <Button variant="ghost" size="sm" onClick={loadDocs}>
                  <RefreshCw className="size-4 ml-1.5" />
                  تازه‌سازی
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {documents.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <Receipt className="size-12 mx-auto mb-3 opacity-40" />
                  <p>هیچ سند دریافت یا پرداختی ثبت نشده است.</p>
                  <Button
                    size="sm"
                    className="mt-4"
                    onClick={() => setMode("create")}
                  >
                    ثبت اولین سند دریافت / پرداخت
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24 text-right">شماره سند</TableHead>
                        <TableHead className="w-28 text-center">نوع سند</TableHead>
                        <TableHead className="w-28 text-center">تاریخ</TableHead>
                        <TableHead className="text-right">طرف‌حساب</TableHead>
                        <TableHead className="w-40 text-left font-mono">مبلغ کل (ریال)</TableHead>
                        <TableHead className="w-36 text-left font-mono">مانده پیش‌دریافت/پرداخت</TableHead>
                        <TableHead className="w-24 text-center">عملیات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map((doc: TreasuryDocument) => (
                        <TableRow key={doc.id}>
                          <TableCell className="font-mono text-sm font-semibold">
                            {doc.docNumber}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={doc.kind === TreasuryDocKind.RECEIPT ? "default" : "secondary"}
                            >
                              {TREASURY_KIND_LABELS[doc.kind]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground">
                            {formatJalaliDate(doc.docDate)}
                          </TableCell>
                          <TableCell className="font-medium">
                            {doc.partyName || doc.partyCode}
                          </TableCell>
                          <TableCell className="text-left font-mono font-bold text-foreground">
                            {formatMoneyRial(doc.total)}
                          </TableCell>
                          <TableCell className="text-left font-mono text-xs">
                            {Number(doc.advanceRemaining) > 0 ? (
                              <span className="text-blue-600">
                                {formatMoneyRial(doc.advanceRemaining)}
                              </span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenDetail(doc.id)}
                            >
                              <Printer className="size-4 ml-1" />
                              مشاهده / چاپ
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {mode === "create" && (
          <div className="space-y-6">
            {/* Header Form */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">مشخصات سند و طرف‌حساب</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
                  <div>
                    <Label htmlFor="kind">نوع عملیات</Label>
                    <select
                      id="kind"
                      className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={docKind}
                      onChange={(e) => handleDocKindChange(e.target.value as TreasuryDocKind)}
                    >
                      <option value={TreasuryDocKind.RECEIPT}>دریافت وجه (رسید دریافت از مشتری)</option>
                      <option value={TreasuryDocKind.PAYMENT}>پرداخت وجه (رسید پرداخت به تأمین‌کننده)</option>
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="party-code">کد طرف‌حساب</Label>
                    <div className="flex gap-2">
                      <Input
                        id="party-code"
                        value={partyCode}
                        onChange={(e) => setPartyCode(e.target.value)}
                        placeholder="مانند CUST-01 یا SUPP-01"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleFetchInvoices}
                        disabled={fetchingInvoices}
                      >
                        فاکتورها
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="party-name">نام طرف‌حساب</Label>
                    <Input
                      id="party-name"
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                      placeholder="شرکت یا شخص طرف حساب"
                    />
                  </div>

                  <div>
                    <Label htmlFor="doc-date">تاریخ سند</Label>
                    <JalaliDateInput
                      id="doc-date"
                      value={docDate}
                      onChange={(val) => setDocDate(val || "")}
                    />
                  </div>

                  <div>
                    <Label htmlFor="desc">شرح سند</Label>
                    <Input
                      id="desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="تسویه صورتحساب‌های ماه جاری"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Payment Methods (روش‌های تسویه: نقد، بانک، چک) */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  روش‌های پرداخت / دریافت ({lines.length} ردیف)
                </CardTitle>
                <Button type="button" variant="outline" size="sm" onClick={handleAddLine}>
                  <Plus className="size-4 ml-1.5" />
                  افزودن روش پرداخت
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {lines.map((line, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-lg border border-border bg-card grid grid-cols-1 gap-4 sm:grid-cols-5 items-end"
                  >
                    <div>
                      <Label>روش تسویه</Label>
                      <select
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                        value={line.method}
                        onChange={(e) => {
                          const val = e.target.value as TreasuryMethod;
                          setLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, method: val } : l)),
                          );
                        }}
                      >
                        <option value={TreasuryMethod.BANK_TRANSFER}>واریز بانکی / حواله</option>
                        <option value={TreasuryMethod.CASH}>صندوق (نقد)</option>
                        <option value={TreasuryMethod.CHEQUE}>چک صیادی</option>
                      </select>
                    </div>

                    <div>
                      <Label>مبلغ (ریال)</Label>
                      <Input
                        type="number"
                        value={line.amount}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, amount: val } : l)),
                          );
                        }}
                        placeholder="10000000"
                      />
                    </div>

                    {line.method === TreasuryMethod.BANK_TRANSFER && (
                      <div>
                        <Label>حساب بانکی</Label>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                          value={line.bankAccountId ?? ""}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setLines((prev) =>
                              prev.map((l, i) => (i === idx ? { ...l, bankAccountId: val } : l)),
                            );
                          }}
                        >
                          <option value="">انتخاب بانک...</option>
                          {bankAccounts.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} ({b.accountNumber})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {line.method === TreasuryMethod.CASH && (
                      <div>
                        <Label>صندوق</Label>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                          value={line.cashBoxId ?? ""}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setLines((prev) =>
                              prev.map((l, i) => (i === idx ? { ...l, cashBoxId: val } : l)),
                            );
                          }}
                        >
                          <option value="">انتخاب صندوق...</option>
                          {cashBoxes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.code})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {line.method === TreasuryMethod.CHEQUE && (
                      <div>
                        <Label>شماره چک / صیاد</Label>
                        <Input
                          value={line.chequeNumber ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLines((prev) =>
                              prev.map((l, i) => (i === idx ? { ...l, chequeNumber: val } : l)),
                            );
                          }}
                          placeholder="1234567890"
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Input
                        value={line.reference ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, reference: val } : l)),
                          );
                        }}
                        placeholder="شماره پیگیری / مرجع"
                      />
                      {lines.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-rose-600"
                          onClick={() => handleRemoveLine(idx)}
                        >
                          حذف
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                <div className="flex justify-end p-2 bg-muted rounded-md text-sm font-semibold">
                  <span>مجموع مبالغ دریافتی / پرداختی:</span>
                  <span className="font-mono mr-2 text-blue-600">
                    {formatMoneyRial(totalMethods)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Invoices Allocation (تخصیص به فاکتورها) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>تخصیص به فاکتورهای باز ({openInvoices.length} فاکتور)</span>
                  {partyCode && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleFetchInvoices}
                      disabled={fetchingInvoices}
                    >
                      جستجوی مجدد فاکتورها
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {openInvoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    {partyCode
                      ? "فاکتور بازی برای این طرف‌حساب یافت نشد. کل مبلغ به عنوان پیش‌دریافت/پیش‌پرداخت ذخیره خواهد شد."
                      : "لطفاً برای تخصیص به فاکتورها، ابتدا کد طرف‌حساب را وارد کرده و دکمه فاکتورها را بزنید."}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-28 text-right">شماره فاکتور</TableHead>
                          <TableHead className="w-28 text-center">تاریخ صدور</TableHead>
                          <TableHead className="w-36 text-left font-mono">مبلغ کل فاکتور</TableHead>
                          <TableHead className="w-36 text-left font-mono">مانده قابل پرداخت</TableHead>
                          <TableHead className="w-40 text-left font-mono">مبلغ تخصیص (ریال)</TableHead>
                          <TableHead className="w-36 text-left font-mono">تخفیف / کسورات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {openInvoices.map((inv) => (
                          <TableRow key={inv.invoiceId}>
                            <TableCell className="font-mono text-sm font-semibold">
                              {inv.invoiceNumber}
                            </TableCell>
                            <TableCell className="text-center text-xs text-muted-foreground">
                              {formatJalaliDate(inv.issueDate)}
                            </TableCell>
                            <TableCell className="text-left font-mono">
                              {formatMoneyRial(inv.total)}
                            </TableCell>
                            <TableCell className="text-left font-mono text-amber-600 font-semibold">
                              {formatMoneyRial(inv.remainingAmount)}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                className="h-8 w-36 text-left font-mono"
                                value={allocations[inv.invoiceId]?.amount ?? ""}
                                onChange={(e) =>
                                  setAllocations((prev) => ({
                                    ...prev,
                                    [inv.invoiceId]: {
                                      amount: e.target.value,
                                      writeoff: prev[inv.invoiceId]?.writeoff ?? "0",
                                    },
                                  }))
                                }
                                placeholder="0"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                className="h-8 w-32 text-left font-mono"
                                value={allocations[inv.invoiceId]?.writeoff ?? ""}
                                onChange={(e) =>
                                  setAllocations((prev) => ({
                                    ...prev,
                                    [inv.invoiceId]: {
                                      amount: prev[inv.invoiceId]?.amount ?? "",
                                      writeoff: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="0"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Summary calculation */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 mt-4 border-t border-border">
                  <div className="text-sm">
                    <span className="text-muted-foreground">مجموع تخصیص یافته: </span>
                    <span className="font-mono font-bold text-emerald-600">
                      {formatMoneyRial(totalAllocated)}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">مجموع تخفیف/کسورات: </span>
                    <span className="font-mono font-bold text-amber-600">
                      {formatMoneyRial(totalWriteoff)}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">مانده پیش‌دریافت/پیش‌پرداخت: </span>
                    <span className="font-mono font-bold text-blue-600">
                      {formatMoneyRial(advanceAmount)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Submit Action */}
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setMode("list")} disabled={submitting}>
                انصراف
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                <Check className="size-4 ml-1.5" />
                {submitting ? "در حال ثبت سند..." : "ثبت و صدور سند حسابداری خزانه‌داری"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Drawer for details / printing */}
      <ReceiptPaymentVoucherDrawer
        doc={selectedDoc}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </EnterpriseRouteGuard>
  );
}
