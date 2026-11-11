"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Barcode,
  Check,
  Eye,
  EyeOff,
  FileText,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader } from "@/components/app/app-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoneyRial } from "@/lib/fa-format";
import {
  createPrintTemplate,
  deletePrintTemplate,
  getDefaultPrintTemplate,
  listPrintTemplates,
  updatePrintTemplate,
} from "@/lib/api/print-templates-client";
import { printBarcodeSheet } from "@/lib/print/open-barcode-sheet-window";
import {
  BarcodeLabelItemDto,
  CreatePrintTemplateDto,
  PRINT_DOC_TYPE_LABELS,
  PRINT_PAPER_SIZE_LABELS,
  PrintColumnConfig,
  PrintDocType,
  PrintPaperSize,
  PrintTemplateDto,
} from "@/types/print-template";

export default function PrintFormBuilderPageWrapper() {
  return (
    <Suspense fallback={null}>
      <PrintFormBuilderPage />
    </Suspense>
  );
}

function PrintFormBuilderPage() {
  const [activeTab, setActiveTab] = useState<"templates" | "barcodes">("templates");
  const [docType, setDocType] = useState<PrintDocType>(PrintDocType.SALES_INVOICE);
  const [paperSize, setPaperSize] = useState<PrintPaperSize>(PrintPaperSize.A4);
  const [templates, setTemplates] = useState<PrintTemplateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form builder state for active document type & paper size
  const [title, setTitle] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [showLogo, setShowLogo] = useState(true);
  const [logoUrl, setLogoUrl] = useState("");
  const [footerNote, setFooterNote] = useState("");
  const [columns, setColumns] = useState<PrintColumnConfig[]>([]);
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);

  // Barcode sheet state
  const [barcodeCols, setBarcodeCols] = useState<4 | 5>(4);
  const [barcodeShowPrice, setBarcodeShowPrice] = useState(true);
  const [barcodeShowSku, setBarcodeShowSku] = useState(true);
  const [barcodeItems, setBarcodeItems] = useState<BarcodeLabelItemDto[]>([
    { sku: "PRD-101", title: "کالای نمونه ۱", barcode: "626000100101", price: 250000, count: 4 },
    { sku: "PRD-102", title: "کالای نمونه ۲", barcode: "626000100102", price: 480000, count: 4 },
  ]);
  const [newItemSku, setNewItemSku] = useState("");
  const [newItemTitle, setNewItemTitle] = useState("");
  const [newItemBarcode, setNewItemBarcode] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemCount, setNewItemCount] = useState("4");
  const [barcodePrinting, setBarcodePrinting] = useState(false);

  const fetchTemplates = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPrintTemplates({ docType });
      setTemplates(list);

      // Also load default preset or active template
      const def = await getDefaultPrintTemplate(docType, paperSize);
      setTitle(def.title);
      setIsDefault(def.isDefault);
      setShowLogo(def.showLogo);
      setLogoUrl(def.logoUrl ?? "");
      setFooterNote(def.options?.footerNote ?? "");
      setColumns(def.columnsConfig ?? []);
      setEditingTemplateId(def.id > 0 ? def.id : null);
    } catch (err: any) {
      setError(err?.message ?? "خطا در دریافت قالب‌های چاپ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, [docType, paperSize]);

  const handleSelectTemplate = (t: PrintTemplateDto) => {
    setEditingTemplateId(t.id);
    setTitle(t.title);
    setPaperSize(t.paperSize);
    setIsDefault(t.isDefault);
    setShowLogo(t.showLogo);
    setLogoUrl(t.logoUrl ?? "");
    setFooterNote(t.options?.footerNote ?? "");
    setColumns(t.columnsConfig ?? []);
    setSuccessMsg(`قالب «${t.title}» جهت ویرایش بارگذاری شد.`);
  };

  const handleResetToDefault = async () => {
    try {
      setLoading(true);
      const def = await getDefaultPrintTemplate(docType, paperSize);
      setTitle(def.title);
      setIsDefault(true);
      setShowLogo(def.showLogo);
      setLogoUrl("");
      setFooterNote("");
      setColumns(def.columnsConfig);
      setEditingTemplateId(null);
      setSuccessMsg("تنظیمات ستون‌ها و گزینه‌ها به حالت پیش‌فرض بازگشت.");
    } catch (err: any) {
      setError(err?.message ?? "خطا در بازنشانی");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!title.trim()) {
      setError("لطفاً عنوان قالب را وارد کنید.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      if (editingTemplateId && editingTemplateId > 0) {
        await updatePrintTemplate(editingTemplateId, {
          title: title.trim(),
          isDefault,
          showLogo,
          logoUrl: logoUrl.trim() || null,
          columnsConfig: columns,
          options: { footerNote: footerNote.trim() },
        });
        setSuccessMsg(`قالب «${title}» با موفقیت به‌روزرسانی شد.`);
      } else {
        const payload: CreatePrintTemplateDto = {
          docType,
          paperSize,
          title: title.trim(),
          isDefault,
          showLogo,
          logoUrl: logoUrl.trim() || null,
          columnsConfig: columns,
          options: { footerNote: footerNote.trim() },
        };
        const created = await createPrintTemplate(payload);
        setEditingTemplateId(created.id);
        setSuccessMsg(`قالب جدید «${created.title}» با موفقیت ذخیره شد.`);
      }
      await fetchTemplates();
    } catch (err: any) {
      setError(err?.message ?? "خطا در ذخیره قالب");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    if (!confirm("آیا از حذف این قالب اطمینان دارید؟")) return;
    setLoading(true);
    try {
      await deletePrintTemplate(id);
      if (editingTemplateId === id) {
        setEditingTemplateId(null);
      }
      setSuccessMsg("قالب با موفقیت حذف شد.");
      await fetchTemplates();
    } catch (err: any) {
      setError(err?.message ?? "خطا در حذف قالب");
    } finally {
      setLoading(false);
    }
  };

  const toggleColumnVisibility = (key: string) => {
    setColumns((prev) =>
      prev.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)),
    );
  };

  const moveColumn = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= columns.length) return;
    const copy = [...columns];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;
    // update order numbers
    copy.forEach((c, idx) => {
      c.order = idx + 1;
    });
    setColumns(copy);
  };

  const toAsciiDigits = (s: string) =>
    s.replace(/[۰-۹٠-٩]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(d) % 10));

  const parsePriceToRials = (raw: string): number | undefined => {
    if (!raw.trim()) return undefined;
    const ascii = toAsciiDigits(raw.trim()).replace(/[^\d.]/g, "");
    if (!ascii) return undefined;
    const parts = ascii.split(".");
    const n = parseInt(parts[0], 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const addBarcodeItem = () => {
    if (!newItemSku.trim() || !newItemTitle.trim()) {
      setError("لطفاً کد کالا و نام کالا را برای برچسب وارد کنید.");
      return;
    }
    const count = parseInt(newItemCount, 10) || 1;
    const price = parsePriceToRials(newItemPrice);
    setBarcodeItems((prev) => [
      ...prev,
      {
        sku: newItemSku.trim(),
        title: newItemTitle.trim(),
        barcode: newItemBarcode.trim() || newItemSku.trim(),
        price,
        count,
      },
    ]);
    setNewItemSku("");
    setNewItemTitle("");
    setNewItemBarcode("");
    setNewItemPrice("");
    setNewItemCount("4");
    setError(null);
  };

  const removeBarcodeItem = (index: number) => {
    setBarcodeItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const totalLabelsCount = barcodeItems.reduce((acc, item) => acc + (item.count ?? 1), 0);

  const handlePrintBarcodes = async () => {
    if (barcodeItems.length === 0) {
      setError("حداقل یک ردیف کالا برای چاپ برچسب اضافه کنید.");
      return;
    }
    setBarcodePrinting(true);
    setError(null);
    try {
      await printBarcodeSheet({
        columns: barcodeCols,
        showPrice: barcodeShowPrice,
        showSku: barcodeShowSku,
        items: barcodeItems,
      });
    } catch (err: any) {
      setError(err?.message ?? "خطا در آماده‌سازی شیت بارکد");
    } finally {
      setBarcodePrinting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="سازنده فرم‌های چاپی و برچسب بارکد"
        description="سفارشی‌سازی ستون‌ها، لوگو و قطع کاغذ (A4، A5 و حرارتی ۸۰ میلی‌متری) برای هر سازمان و تولید شیت برچسب بارکد"
        icon={<Printer className="size-6 text-indigo-500" />}
        actions={
          <div className="flex gap-2">
            <Link
              href="/app/invoicing"
              className={buttonVariants({ variant: "outline" })}
            >
              بازگشت به صورتحساب‌ها
            </Link>
          </div>
        }
      />

      {error && <ErrorNotice title="خطا" message={error} />}
      {successMsg && (
        <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {successMsg}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("templates")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "templates"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="size-4" />
          قالب‌های اسناد (فاکتور، سند دریافتی/پرداختی، انبار)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("barcodes")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "barcodes"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Barcode className="size-4" />
          چاپ برچسب بارکد کالا (A4 چند ستونه)
        </button>
      </div>

      <LoadingLine show={loading} />

      {activeTab === "templates" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Right column: Document selector & Saved templates */}
          <div className="flex flex-col gap-5 lg:col-span-1">
            <Card className="p-4">
              <h3 className="mb-3 text-base font-semibold">انتخاب نوع سند و قطع کاغذ</h3>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    نوع سند
                  </label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value as PrintDocType)}
                    className="w-full rounded-md border border-input bg-background p-2 text-sm"
                  >
                    <option value={PrintDocType.SALES_INVOICE}>
                      {PRINT_DOC_TYPE_LABELS[PrintDocType.SALES_INVOICE]}
                    </option>
                    <option value={PrintDocType.RECEIPT_PAYMENT_VOUCHER}>
                      {PRINT_DOC_TYPE_LABELS[PrintDocType.RECEIPT_PAYMENT_VOUCHER]}
                    </option>
                    <option value={PrintDocType.STOCK_DOCUMENT}>
                      {PRINT_DOC_TYPE_LABELS[PrintDocType.STOCK_DOCUMENT]}
                    </option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    اندازه کاغذ
                  </label>
                  <select
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value as PrintPaperSize)}
                    className="w-full rounded-md border border-input bg-background p-2 text-sm"
                  >
                    <option value={PrintPaperSize.A4}>{PRINT_PAPER_SIZE_LABELS[PrintPaperSize.A4]}</option>
                    <option value={PrintPaperSize.A5}>{PRINT_PAPER_SIZE_LABELS[PrintPaperSize.A5]}</option>
                    <option value={PrintPaperSize.THERMAL_80MM}>
                      {PRINT_PAPER_SIZE_LABELS[PrintPaperSize.THERMAL_80MM]}
                    </option>
                  </select>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold">قالب‌های سفارشی ذخیره‌شده</h3>
                <span className="text-xs text-muted-foreground">
                  {templates.length} قالب
                </span>
              </div>
              {templates.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  هنوز قالب سفارشی برای این سند ثبت نشده است (قالب پیش‌فرض سیستم اعمال می‌شود).
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      className={`flex items-center justify-between rounded-lg border p-2.5 text-sm transition-colors ${
                        editingTemplateId === t.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-accent/40"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectTemplate(t)}
                        className="flex flex-1 flex-col text-start"
                      >
                        <span className="font-medium">{t.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.paperSizeLabel ?? t.paperSize} {t.isDefault && "• پیش‌فرض"}
                        </span>
                      </button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeleteTemplate(t.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Left column: Template settings & Column builder */}
          <div className="flex flex-col gap-5 lg:col-span-2">
            <Card className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div>
                  <h3 className="text-lg font-semibold">
                    {editingTemplateId ? "ویرایش قالب" : "پیکربندی قالب جدید"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    ستون‌های جدول، نمایش نشان تجاری و یادداشت پاورقی را تنظیم کنید.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleResetToDefault}>
                    <RotateCcw className="size-3.5" />
                    بازنشانی به پیش‌فرض
                  </Button>
                  <Button size="sm" onClick={handleSaveTemplate}>
                    <Save className="size-3.5" />
                    {editingTemplateId ? "به‌روزرسانی قالب" : "ذخیره به عنوان قالب جدید"}
                  </Button>
                </div>
              </div>

              {/* Form inputs */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium">عنوان قالب چاپی</label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="مثال: فاکتور رسمی شرکت، فیش حرارتی انبار..."
                  />
                </div>

                <div className="flex items-center gap-4 pt-6">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)}
                      className="rounded border-input text-primary"
                    />
                    <span>تنظیم به عنوان قالب پیش‌فرض</span>
                  </label>

                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showLogo}
                      onChange={(e) => setShowLogo(e.target.checked)}
                      className="rounded border-input text-primary"
                    />
                    <span>نمایش لوگو در سربرگ</span>
                  </label>
                </div>

                {showLogo && (
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-medium">
                      نشانی اینترنتی لوگو (Logo URL - اختیاری)
                    </label>
                    <Input
                      value={logoUrl}
                      onChange={(e) => setLogoUrl(e.target.value)}
                      placeholder="https://example.com/logo.png"
                    />
                  </div>
                )}

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium">یادداشت / متن پاورقی</label>
                  <Input
                    value={footerNote}
                    onChange={(e) => setFooterNote(e.target.value)}
                    placeholder="پیام تشکر، شرایط تسویه، شماره حساب‌ها..."
                  />
                </div>
              </div>

              {/* Column Reordering and Visibility */}
              <div className="mt-6 border-t pt-4">
                <h4 className="mb-3 text-sm font-semibold">
                  مدیریت و چینش ستون‌های جدول چاپ ({columns.length} ستون)
                </h4>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-start text-xs">
                    <thead className="bg-muted text-muted-foreground">
                      <tr>
                        <th className="p-2 text-start">ترتیب</th>
                        <th className="p-2 text-start">عنوان ستون</th>
                        <th className="p-2 text-start">شناسه فیلد</th>
                        <th className="p-2 text-center">وضعیت نمایش</th>
                        <th className="p-2 text-center">جابجایی</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {columns.map((col, idx) => (
                        <tr
                          key={col.key}
                          className={col.visible ? "bg-background" : "bg-muted/30 text-muted-foreground"}
                        >
                          <td className="p-2 font-mono text-center w-12">{idx + 1}</td>
                          <td className="p-2 font-medium">
                            <Input
                              value={col.label}
                              onChange={(e) => {
                                const val = e.target.value;
                                setColumns((prev) =>
                                  prev.map((c) => (c.key === col.key ? { ...c, label: val } : c)),
                                );
                              }}
                              className="h-7 text-xs"
                            />
                          </td>
                          <td className="p-2 font-mono text-muted-foreground">{col.key}</td>
                          <td className="p-2 text-center w-28">
                            <Button
                              size="sm"
                              variant={col.visible ? "secondary" : "ghost"}
                              onClick={() => toggleColumnVisibility(col.key)}
                              className="h-7 gap-1 text-xs"
                            >
                              {col.visible ? (
                                <>
                                  <Eye className="size-3 text-emerald-600" />
                                  <span>نمایش</span>
                                </>
                              ) : (
                                <>
                                  <EyeOff className="size-3 text-muted-foreground" />
                                  <span>مخفی</span>
                                </>
                              )}
                            </Button>
                          </td>
                          <td className="p-2 text-center w-20">
                            <div className="flex justify-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={idx === 0}
                                onClick={() => moveColumn(idx, "up")}
                                className="size-6"
                              >
                                <ArrowUp className="size-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={idx === columns.length - 1}
                                onClick={() => moveColumn(idx, "down")}
                                className="size-6"
                              >
                                <ArrowDown className="size-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === "barcodes" && (
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
              <div>
                <h3 className="text-lg font-semibold">شیت برچسب بارکد (A4 Sheet Barcodes)</h3>
                <p className="text-xs text-muted-foreground">
                  تولید شیت استاندارد چاپ برچسب بارکد به صورت ۴ یا ۵ ستونه بر روی کاغذ A4
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  مجموع: <strong>{totalLabelsCount}</strong> برچسب
                </span>
                <Button onClick={handlePrintBarcodes} disabled={barcodePrinting || barcodeItems.length === 0}>
                  <Printer className="size-4" />
                  چاپ شیت بارکد A4
                </Button>
              </div>
            </div>

            {/* Controls */}
            <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium">تعداد ستون‌ها در هر صفحه A4</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={barcodeCols === 4 ? "default" : "outline"}
                    size="sm"
                    onClick={() => setBarcodeCols(4)}
                    className="flex-1"
                  >
                    ۴ ستونه (عرض بزرگتر)
                  </Button>
                  <Button
                    type="button"
                    variant={barcodeCols === 5 ? "default" : "outline"}
                    size="sm"
                    onClick={() => setBarcodeCols(5)}
                    className="flex-1"
                  >
                    ۵ ستونه (فشرده)
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-4 sm:col-span-2 pt-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={barcodeShowPrice}
                    onChange={(e) => setBarcodeShowPrice(e.target.checked)}
                    className="rounded border-input text-primary"
                  />
                  <span>نمایش قیمت ریالی در برچسب</span>
                </label>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={barcodeShowSku}
                    onChange={(e) => setBarcodeShowSku(e.target.checked)}
                    className="rounded border-input text-primary"
                  />
                  <span>نمایش کد کالا (SKU) در برچسب</span>
                </label>
              </div>
            </div>

            {/* Add item row */}
            <div className="mb-6 rounded-lg border bg-muted/20 p-4">
              <h4 className="mb-3 text-xs font-semibold">افزودن کالای جدید به شیت بارکد</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">کد کالا (SKU)</label>
                  <Input
                    placeholder="PRD-001"
                    value={newItemSku}
                    onChange={(e) => setNewItemSku(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] text-muted-foreground">نام کالا</label>
                  <Input
                    placeholder="عنوان محصول..."
                    value={newItemTitle}
                    onChange={(e) => setNewItemTitle(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">بارکد میله‌ای (اختیاری)</label>
                  <Input
                    placeholder="626..."
                    value={newItemBarcode}
                    onChange={(e) => setNewItemBarcode(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">قیمت (ریال - اختیاری)</label>
                  <Input
                    placeholder="مبلغ..."
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="w-16">
                    <label className="mb-1 block text-[11px] text-muted-foreground">تعداد</label>
                    <Input
                      type="number"
                      min="1"
                      max="100"
                      value={newItemCount}
                      onChange={(e) => setNewItemCount(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <Button size="sm" onClick={addBarcodeItem} className="h-8 gap-1">
                    <Plus className="size-3.5" />
                    افزودن
                  </Button>
                </div>
              </div>
            </div>

            {/* Items list */}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-start text-xs">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="p-2 text-start">ردیف</th>
                    <th className="p-2 text-start">کد کالا</th>
                    <th className="p-2 text-start">عنوان کالا</th>
                    <th className="p-2 text-start">بارکد</th>
                    <th className="p-2 text-start">قیمت (ریال)</th>
                    <th className="p-2 text-center">تعداد برچسب</th>
                    <th className="p-2 text-center">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {barcodeItems.map((item, idx) => (
                    <tr key={`${item.sku}-${idx}`}>
                      <td className="p-2 text-center font-mono w-12">{idx + 1}</td>
                      <td className="p-2 font-mono font-medium">{item.sku}</td>
                      <td className="p-2">{item.title}</td>
                      <td className="p-2 font-mono text-muted-foreground">{item.barcode || item.sku}</td>
                      <td className="p-2">
                        {item.price != null ? formatMoneyRial(item.price) : "—"}
                      </td>
                      <td className="p-2 text-center font-medium">{item.count ?? 1}</td>
                      <td className="p-2 text-center w-16">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeBarcodeItem(idx)}
                          className="size-7 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
