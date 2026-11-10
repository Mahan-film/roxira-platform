"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Layers,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";

import { useAccess } from "@/components/app/access-provider";
import { ErrorNotice, PageHeader, StatCard } from "@/components/app/app-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createDimension,
  getDimensionBalances,
  listDimensions,
} from "@/lib/api/dimensions-client";
import {
  buildDimensionTree,
  calculateBalancesSummary,
  getBalanceDisplay,
  isValidDimensionCode,
  type DimensionTreeNode,
} from "@/lib/dimensions";
import { formatJalaliDate, formatMoneyRial } from "@/lib/fa-format";
import { cn } from "@/lib/utils";
import {
  DIMENSION_KIND_DESCRIPTIONS,
  DIMENSION_KIND_LABELS,
  DimensionKind,
  type CreateDimensionInput,
  type Dimension,
  type DimensionBalanceRow,
} from "@/types/dimension";

const KIND_TABS = [
  { id: DimensionKind.COST_CENTER, label: DIMENSION_KIND_LABELS[DimensionKind.COST_CENTER], icon: Building2 },
  { id: DimensionKind.PROJECT, label: DIMENSION_KIND_LABELS[DimensionKind.PROJECT], icon: Layers },
  { id: DimensionKind.DETAIL, label: DIMENSION_KIND_LABELS[DimensionKind.DETAIL], icon: FolderTree },
] as const;

type ViewMode = "list" | "balances";

function defaultFiscalPeriod(): { from: string; to: string } {
  // 1405 Jalali standard calendar year in Gregorian YYYY-MM-DD
  return { from: "2026-03-21", to: "2027-03-20" };
}

export default function DimensionsPage() {
  const { can, loading: accessLoading } = useAccess();
  const [activeKind, setActiveKind] = useState<DimensionKind>(DimensionKind.COST_CENTER);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // State
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [balances, setBalances] = useState<DimensionBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Date range for balances
  const [period, setPeriod] = useState(defaultFiscalPeriod);

  // New dimension form drawer/dialog state
  const [isCreating, setIsCreating] = useState(false);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formParentCode, setFormParentCode] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canCreate = can("accounting", "create");

  // Load dimensions list
  const loadDimensionsData = async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listDimensions(activeKind, signal);
      setDimensions(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "خطا در بارگذاری فهرست مراکز");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  // Load balances
  const loadBalancesData = async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDimensionBalances(activeKind, period.from, period.to, signal);
      setBalances(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "خطا در دریافت گردش و مانده");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    if (viewMode === "list") {
      loadDimensionsData(controller.signal);
    } else {
      loadBalancesData(controller.signal);
    }
    return () => controller.abort();
  }, [activeKind, viewMode]);

  // Filtered dimensions
  const filteredDimensions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dimensions;
    return dimensions.filter(
      (d) => d.code.toLowerCase().includes(q) || d.name.toLowerCase().includes(q),
    );
  }, [dimensions, search]);

  // Dimension tree for cost centres
  const dimensionTree = useMemo(() => {
    if (activeKind !== DimensionKind.COST_CENTER) return [];
    return buildDimensionTree(filteredDimensions);
  }, [activeKind, filteredDimensions]);

  // Balances summary
  const summary = useMemo(() => {
    return calculateBalancesSummary(balances);
  }, [balances]);

  // Handle create submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidDimensionCode(formCode)) {
      setFormError("کد مرکز باید فقط شامل حروف لاتین، عدد، نقطه و خط تیره تا ۳۲ نویسه باشد.");
      return;
    }
    if (formName.trim().length < 1) {
      setFormError("عنوان مرکز را وارد کنید.");
      return;
    }

    setFormSubmitting(true);
    setFormError(null);
    try {
      const input: CreateDimensionInput = {
        kind: activeKind,
        code: formCode.trim().toUpperCase(),
        name: formName.trim(),
        parentCode: activeKind === DimensionKind.COST_CENTER && formParentCode ? formParentCode : undefined,
      };
      await createDimension(input);
      setIsCreating(false);
      setFormCode("");
      setFormName("");
      setFormParentCode("");
      await loadDimensionsData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "خطا در ثبت مرکز جدید");
    } finally {
      setFormSubmitting(false);
    }
  };

  // Guard access
  if (!accessLoading && !can("accounting", "read")) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-border p-4 text-sm text-muted-foreground"
        data-testid="no-access"
      >
        نقش شما به مشاهده اطلاعات حسابداری و تفصیلی‌ها دسترسی ندارد.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="dimensions-page">
      <PageHeader
        title="تفصیلی شناور، مراکز هزینه و پروژه"
        description="مدیریت ابعاد تفصیلی و کنترلی حسابداری (سطح ۴)، مراکز هزینه، پروژه‌ها و بررسی تراز و گردش مالی آن‌ها"
        icon={<FolderTree className="size-6 text-indigo-500" />}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Kind Navigation Tabs */}
      <div
        role="tablist"
        aria-label="نوع تفصیلی / مرکز"
        className="flex flex-wrap gap-2 border-b border-border pb-2"
      >
        {KIND_TABS.map((t) => {
          const Icon = t.icon;
          const isSelected = activeKind === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={isSelected}
              onClick={() => {
                setActiveKind(t.id);
                setIsCreating(false);
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                isSelected
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Header Info & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-foreground">
            {DIMENSION_KIND_LABELS[activeKind]}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {DIMENSION_KIND_DESCRIPTIONS[activeKind]}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode Switcher */}
          <div className="flex rounded-lg border border-input p-1 bg-muted/20">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "px-3 py-1 text-xs rounded-md transition-colors",
                viewMode === "list" ? "bg-background shadow-xs font-bold text-foreground" : "text-muted-foreground",
              )}
            >
              فهرست و ساختار
            </button>
            <button
              type="button"
              onClick={() => setViewMode("balances")}
              className={cn(
                "px-3 py-1 text-xs rounded-md transition-colors",
                viewMode === "balances" ? "bg-background shadow-xs font-bold text-foreground" : "text-muted-foreground",
              )}
            >
              گردش و مانده مالی
            </button>
          </div>

          {canCreate && !isCreating && (
            <Button
              size="sm"
              onClick={() => {
                setIsCreating(true);
                setFormError(null);
              }}
              className="gap-1.5"
            >
              <Plus className="size-4" />
              تعریف {DIMENSION_KIND_LABELS[activeKind]} جدید
            </Button>
          )}
        </div>
      </div>

      {/* Create Form Drawer / Inline Card */}
      {isCreating && (
        <Card className="border-indigo-500/30 bg-indigo-500/5 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center justify-between">
              <span>تعریف {DIMENSION_KIND_LABELS[activeKind]} جدید</span>
              <Button size="sm" variant="ghost" onClick={() => setIsCreating(false)}>
                انصراف
              </Button>
            </CardTitle>
            <CardDescription className="text-xs">
              کد شناسه و عنوان تفصیلی را مشخص کنید. کدها یکتا هستند و پس از ثبت، قابل ارجاع در اسناد می‌باشند.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
              {formError && (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertDescription className="text-xs">{formError}</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dim-code" className="text-xs">
                    کد شناسه (لاتین):
                  </Label>
                  <Input
                    id="dim-code"
                    dir="ltr"
                    placeholder="مثال: CC-101"
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    maxLength={32}
                    className="font-mono text-sm h-9"
                    required
                  />
                  <span className="text-[10px] text-muted-foreground">
                    حروف لاتین، ارقام، نقطه، زیرخط و خط تیره
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dim-name" className="text-xs">
                    عنوان فارسی:
                  </Label>
                  <Input
                    id="dim-name"
                    placeholder="مثال: دپارتمان بازاریابی و فروش"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    maxLength={128}
                    className="text-sm h-9"
                    required
                  />
                </div>

                {activeKind === DimensionKind.COST_CENTER && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="dim-parent" className="text-xs">
                      مرکز هزینه بالادست (اختیاری):
                    </Label>
                    <select
                      id="dim-parent"
                      value={formParentCode}
                      onChange={(e) => setFormParentCode(e.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                    >
                      <option value="">بدون بالادست (مرکز اصلی)</option>
                      {dimensions.map((d) => (
                        <option key={d.code} value={d.code}>
                          {d.code} — {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreating(false)}
                  disabled={formSubmitting}
                >
                  انصراف
                </Button>
                <Button type="submit" size="sm" disabled={formSubmitting || !formCode.trim() || !formName.trim()}>
                  {formSubmitting ? "در حال ثبت…" : "ذخیره مرکز"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* VIEW MODE 1: LIST & HIERARCHY */}
      {viewMode === "list" && (
        <Card>
          <CardHeader className="pb-3 flex flex-wrap flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">فهرست و سلسله‌مراتب</CardTitle>
              <CardDescription>
                تعداد {filteredDimensions.length} مورد ثبت‌شده
              </CardDescription>
            </div>
            <div className="w-64">
              <Input
                placeholder="جستجو در کد یا نام..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                در حال بارگذاری فهرست…
              </div>
            ) : filteredDimensions.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                هیچ موردی تعریف نشده است.
              </div>
            ) : (
              <table className="w-full text-xs text-start border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="p-3 text-start font-semibold">کد شناسه</th>
                    <th className="p-3 text-start font-semibold">عنوان</th>
                    <th className="p-3 text-start font-semibold">نوع</th>
                    {activeKind === DimensionKind.COST_CENTER && (
                      <th className="p-3 text-start font-semibold">مرکز بالادست</th>
                    )}
                    <th className="p-3 text-center font-semibold">تاریخ ایجاد</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDimensions.map((d) => {
                    const parent = dimensions.find((p) => p.id === d.parentId);
                    return (
                      <tr key={d.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                        <td className="p-3 font-mono font-bold text-foreground">
                          {d.code}
                        </td>
                        <td className="p-3 font-medium text-foreground">
                          {d.name}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className="text-[10px]">
                            {DIMENSION_KIND_LABELS[d.kind]}
                          </Badge>
                        </td>
                        {activeKind === DimensionKind.COST_CENTER && (
                          <td className="p-3 text-muted-foreground">
                            {parent ? (
                              <span className="font-mono text-xs">
                                {parent.code} ({parent.name})
                              </span>
                            ) : (
                              <span className="text-[10px]">— (اصلی)</span>
                            )}
                          </td>
                        )}
                        <td className="p-3 text-center text-muted-foreground font-mono">
                          {formatJalaliDate(d.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* VIEW MODE 2: TURNOVER & BALANCES */}
      {viewMode === "balances" && (
        <div className="flex flex-col gap-6">
          {/* Filter Bar */}
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Calendar className="size-4 text-muted-foreground" />
                  <span className="text-xs font-medium">بازه گزارش:</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="date-from" className="text-xs text-muted-foreground">
                    از:
                  </Label>
                  <Input
                    id="date-from"
                    dir="ltr"
                    type="date"
                    value={period.from}
                    onChange={(e) => setPeriod((prev) => ({ ...prev, from: e.target.value }))}
                    className="h-8 text-xs font-mono w-36"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="date-to" className="text-xs text-muted-foreground">
                    تا:
                  </Label>
                  <Input
                    id="date-to"
                    dir="ltr"
                    type="date"
                    value={period.to}
                    onChange={(e) => setPeriod((prev) => ({ ...prev, to: e.target.value }))}
                    className="h-8 text-xs font-mono w-36"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => loadBalancesData()} className="gap-1 h-8 text-xs">
                  <RefreshCw className="size-3.5" />
                  به‌روزرسانی
                </Button>
              </div>

              <div className="text-xs text-muted-foreground">
                محاسبه بر مبنای اسناد قطعی‌شده (POSTED)
              </div>
            </CardContent>
          </Card>

          {/* Balance Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">مجموع گردش بدهکار</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold text-foreground">
                  {formatMoneyRial(summary.totalDebit.toString())}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">مجموع گردش بستانکار</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold text-foreground">
                  {formatMoneyRial(summary.totalCredit.toString())}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">خالص مانده کل</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                  {formatMoneyRial(summary.netBalance.toString())}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Balances Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">جدول تراز گردش و مانده</CardTitle>
              <CardDescription>
                ارقام به ریال محاسبه شده‌اند
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {loading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  در حال محاسبه گردش و مانده…
                </div>
              ) : balances.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  هیچ گردش مالی برای این نوع در بازه انتخابی یافت نشد.
                </div>
              ) : (
                <table className="w-full text-xs text-start border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="p-3 text-start font-semibold">کد شناسه</th>
                      <th className="p-3 text-start font-semibold">عنوان</th>
                      <th className="p-3 text-end font-semibold">گردش بدهکار</th>
                      <th className="p-3 text-end font-semibold">گردش بستانکار</th>
                      <th className="p-3 text-end font-semibold">مانده نهایی</th>
                      <th className="p-3 text-center font-semibold">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((b) => {
                      const display = getBalanceDisplay(b.balance);
                      return (
                        <tr key={b.code} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                          <td className="p-3 font-mono font-bold">{b.code}</td>
                          <td className="p-3 font-medium">{b.name}</td>
                          <td className="p-3 text-end font-mono">
                            {formatMoneyRial(b.debit)}
                          </td>
                          <td className="p-3 text-end font-mono">
                            {formatMoneyRial(b.credit)}
                          </td>
                          <td className="p-3 text-end font-mono font-bold">
                            {formatMoneyRial(display.amountMinor.toString())}
                          </td>
                          <td className="p-3 text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] font-bold px-1.5",
                                display.status === "DEBIT" && "border-blue-400 text-blue-600",
                                display.status === "CREDIT" && "border-amber-400 text-amber-600",
                                display.status === "SETTLED" && "text-muted-foreground",
                              )}
                            >
                              {display.statusFa}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
