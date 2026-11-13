"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Plus,
  Printer,
  Receipt,
  Search,
} from "lucide-react";

import {
  ErrorNotice,
  LoadingLine,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  convertQuotationToInvoice,
  createQuotation,
  getQuotation,
  listQuotations,
} from "@/lib/api/quotations-client";
import { getMyTenant } from "@/lib/api/tenants-client";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { printQuotation } from "@/lib/print/open-quotation-window";
import {
  QUOTATION_STATUS_LABELS,
  type CreateQuotationDto,
  type SalesQuotationResponseDto,
  type SalesQuotationStatus,
} from "@/types/quotation";

export default function QuotationsPageWrapper() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">در حال بارگذاری پیش‌فاکتورها...</div>}>
      <QuotationsPage />
    </Suspense>
  );
}

function QuotationsPage() {
  const [quotations, setQuotations] = useState<SalesQuotationResponseDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<number | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const [isNewDrawerOpen, setIsNewDrawerOpen] = useState(false);
  const [tenantName, setTenantName] = useState("سازمان من");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listQuotations({
        status: statusFilter || undefined,
        limit: 50,
      });
      setQuotations(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadData();
    getMyTenant()
      .then((t) => {
        if (t?.name) setTenantName(t.name);
      })
      .catch(() => {});
  }, [loadData]);

  const handleConvert = async (quotation: SalesQuotationResponseDto) => {
    if (quotation.status === "CONVERTED" || quotation.convertedInvoiceId) return;
    setConvertingId(quotation.id);
    setError(null);
    setSuccessNotice(null);
    try {
      const result = await convertQuotationToInvoice(quotation.id);
      setSuccessNotice(
        `پیش‌فاکتور ${quotation.number} با موفقیت به فاکتور فروش شماره ${result.taxInvoiceNumber} تبدیل شد.`,
      );
      await loadData();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setConvertingId(null);
    }
  };

  const handlePrint = async (quotation: SalesQuotationResponseDto) => {
    try {
      const full = await getQuotation(quotation.id);
      printQuotation(full, { sellerName: tenantName });
    } catch (err) {
      setError(loadErrorMessage(err));
    }
  };

  const filtered = quotations.filter((q) => {
    if (!search) return true;
    return (
      q.number.includes(search) ||
      q.partyCode.includes(search) ||
      (q.note && q.note.includes(search))
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="پیش‌فاکتورهای فروش"
        description="ثبت، مدیریت و تبدیل ۱-کلیکی پیش‌فاکتور به صورتحساب فروش به همراه کنترل اعتبار و چاپ استاندارد."
        icon={<FileSpreadsheet className="size-6 text-primary" />}
        actions={
          <Button onClick={() => setIsNewDrawerOpen(true)}>
            <Plus className="ml-2 h-4 w-4" />
            پیش‌فاکتور جدید
          </Button>
        }
      />

      {error && <ErrorNotice title="خطا" message={error} />}
      {successNotice && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{successNotice}</p>
        </div>
      )}

      {/* Controls */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-1 items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="جستجو در شماره پیش‌فاکتور یا کد مشتری..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background"
            >
              <option value="">همه وضعیت‌ها</option>
              <option value="DRAFT">پیش‌نویس</option>
              <option value="SENT">ارسال‌شده</option>
              <option value="ACCEPTED">پذیرفته‌شده</option>
              <option value="CONVERTED">تبدیل‌شده به فاکتور</option>
              <option value="EXPIRED">منقضی‌شده</option>
              <option value="REJECTED">رد شده</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Content */}
      {loading ? (
        <LoadingLine show={true} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileSpreadsheet className="size-6" />}
          description={search ? "موردی با این مشخصات یافت نشد." : "هنوز هیچ پیش‌فاکتوری ثبت نشده است."}
          action={
            <Button onClick={() => setIsNewDrawerOpen(true)}>
              <Plus className="ml-2 h-4 w-4" />
              صدور اولین پیش‌فاکتور
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-right text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="p-3">شماره</th>
                <th className="p-3">کد مشتری</th>
                <th className="p-3">تاریخ صدور</th>
                <th className="p-3">مهلت اعتبار</th>
                <th className="p-3">مبلغ کل</th>
                <th className="p-3">وضعیت</th>
                <th className="p-3 text-left">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((item) => {
                const isConverted = item.status === "CONVERTED" || Boolean(item.convertedInvoiceId);
                const isExpired = item.status === "EXPIRED";
                const isRejected = item.status === "REJECTED";
                const canConvert = !isConverted && !isExpired && !isRejected;

                return (
                  <tr key={item.id} className="transition-colors hover:bg-muted/30">
                    <td className="p-3 font-semibold text-foreground">
                      {item.number}
                    </td>
                    <td className="p-3 text-muted-foreground">{item.partyCode}</td>
                    <td className="p-3 text-muted-foreground">
                      {formatJalaliDate(item.quoteDate)}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {item.validUntil ? (
                        <span className={isExpired ? "text-destructive font-medium" : ""}>
                          {formatJalaliDate(item.validUntil)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3 font-medium">
                      {formatMoneyRial(item.totalAmount)}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="p-3 text-left">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePrint(item)}
                          title="چاپ پیش‌فاکتور (قالب T81)"
                        >
                          <Printer className="ml-1 h-3.5 w-3.5" />
                          چاپ
                        </Button>

                        {canConvert && (
                          <Button
                            size="sm"
                            variant="default"
                            disabled={convertingId === item.id}
                            onClick={() => handleConvert(item)}
                          >
                            <Receipt className="ml-1 h-3.5 w-3.5" />
                            {convertingId === item.id ? "در حال تبدیل..." : "تبدیل به فاکتور"}
                          </Button>
                        )}

                        {isConverted && item.convertedInvoiceId && (
                          <Link
                            href="/app/invoicing"
                            className="inline-flex items-center text-xs font-medium text-primary hover:underline"
                          >
                            مشاهده فاکتور
                            <ArrowRight className="mr-1 h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Quotation Drawer */}
      <Drawer
        open={isNewDrawerOpen}
        onClose={() => setIsNewDrawerOpen(false)}
        title="صدور پیش‌فاکتور جدید"
      >
        <NewQuotationForm
          onSuccess={() => {
            setIsNewDrawerOpen(false);
            loadData();
          }}
          onCancel={() => setIsNewDrawerOpen(false)}
        />
      </Drawer>
    </div>
  );
}

function StatusBadge({ status }: { status: SalesQuotationStatus }) {
  switch (status) {
    case "DRAFT":
      return <Badge variant="secondary">پیش‌نویس</Badge>;
    case "SENT":
      return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400">ارسال‌شده</Badge>;
    case "ACCEPTED":
      return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">پذیرفته‌شده</Badge>;
    case "CONVERTED":
      return <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-400">تبدیل‌شده به فاکتور</Badge>;
    case "EXPIRED":
      return <Badge variant="destructive">منقضی‌شده</Badge>;
    case "REJECTED":
      return <Badge variant="outline" className="text-muted-foreground">رد شده</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function NewQuotationForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [partyCode, setPartyCode] = useState("");
  const [quoteDate, setQuoteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(100000);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyCode.trim()) {
      setError("کد طرف‌حساب الزامی است.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createQuotation({
        partyCode: partyCode.trim(),
        quoteDate,
        validUntil: validUntil || undefined,
        note: note.trim() || undefined,
        lines: [
          {
            lineNo: 1,
            itemId: 1,
            description: description.trim() || "کالای آزمایشی",
            quantity: Number(quantity),
            unitPrice: Number(unitPrice),
            discount: 0,
          },
        ],
      });
      onSuccess();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 text-right">
      {error && <ErrorNotice title="خطا" message={error} />}

      <div>
        <label className="mb-1 block text-sm font-medium">کد طرف‌حساب / مشتری *</label>
        <Input
          placeholder="مثال: CUST-001"
          value={partyCode}
          onChange={(e) => setPartyCode(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">تاریخ پیش‌فاکتور *</label>
          <Input
            type="date"
            value={quoteDate}
            onChange={(e) => setQuoteDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">مهلت اعتبار (انقضا)</label>
          <Input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border p-3 space-y-3 bg-muted/20">
        <h4 className="text-sm font-semibold">اقلام پیش‌فاکتور</h4>
        <div>
          <label className="mb-1 block text-xs">شرح کالا / خدمت</label>
          <Input
            placeholder="شرح کالا..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs">تعداد</label>
            <Input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs">قیمت واحد (ریال)</label>
            <Input
              type="number"
              min="0"
              value={unitPrice}
              onChange={(e) => setUnitPrice(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">توضیحات</label>
        <Input
          placeholder="توضیحات یا شرایط فروش..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button type="button" variant="ghost" onClick={onCancel}>
          انصراف
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "در حال ثبت..." : "ثبت پیش‌فاکتور"}
        </Button>
      </div>
    </form>
  );
}
