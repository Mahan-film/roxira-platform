"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, FileText, Filter, Play, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { ErrorNotice, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoneyRial } from "@/lib/fa-format";

interface WhitelistedColumn {
  id: string;
  labelFa: string;
  type: string;
  aggregatable: string[];
}

interface DatasetInfo {
  id: string;
  labelFa: string;
  descriptionFa: string;
  columns: WhitelistedColumn[];
}

interface FilterRow {
  column: string;
  op: string;
  value: string;
}

interface QueryResult {
  dataset: string;
  columns: Array<{ id: string; labelFa: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  durationMs: number;
}

interface TemplateItem {
  id: string;
  name: string;
  description: string | null;
  dataset: string;
  createdAt: string;
}

export default function ReportBuilderPage() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>("accounting_ledger");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);

  const currentDataset = datasets.find((d) => d.id === selectedDataset);

  // Load available datasets
  useEffect(() => {
    async function loadMeta() {
      try {
        const res = await fetch("/api/proxy/report-builder/datasets");
        if (!res.ok) throw new Error("بارگذاری مجموعه‌های داده ممکن نشد.");
        const data: DatasetInfo[] = await res.json();
        setDatasets(data);
        if (data.length > 0) {
          setSelectedDataset(data[0].id);
          setSelectedColumns(data[0].columns.map((c) => c.id));
        }
      } catch (err) {
        setError(loadErrorMessage(err));
      }
    }
    loadMeta();
  }, []);

  // When dataset changes, default select all columns
  useEffect(() => {
    if (currentDataset) {
      setSelectedColumns(currentDataset.columns.map((c) => c.id));
      setFilters([]);
    }
  }, [selectedDataset]);

  const toggleColumn = (colId: string) => {
    if (selectedColumns.includes(colId)) {
      if (selectedColumns.length > 1) {
        setSelectedColumns(selectedColumns.filter((c) => c !== colId));
      }
    } else {
      setSelectedColumns([...selectedColumns, colId]);
    }
  };

  const addFilter = () => {
    if (!currentDataset || currentDataset.columns.length === 0) return;
    setFilters([...filters, { column: currentDataset.columns[0].id, op: "eq", value: "" }]);
  };

  const removeFilter = (idx: number) => {
    setFilters(filters.filter((_, i) => i !== idx));
  };

  const updateFilter = (idx: number, patch: Partial<FilterRow>) => {
    setFilters(filters.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const handleRunQuery = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        dataset: selectedDataset,
        columns: selectedColumns,
        filters: filters
          .filter((f) => f.value.trim() !== "")
          .map((f) => ({ column: f.column, op: f.op, value: f.value.trim() })),
        limit: 100,
      };

      const res = await fetch("/api/proxy/report-builder/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "خطا در اجرای گزارش.");
      }

      const data: QueryResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: "xlsx" | "pdf") => {
    try {
      const payload = {
        dataset: selectedDataset,
        columns: selectedColumns,
        filters: filters
          .filter((f) => f.value.trim() !== "")
          .map((f) => ({ column: f.column, op: f.op, value: f.value.trim() })),
        format,
        title: currentDataset?.labelFa || "گزارش سفارشی",
      };

      const res = await fetch("/api/proxy/report-builder/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("دریافت فایل خروجی ممکن نشد.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${selectedDataset}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(loadErrorMessage(err));
    }
  };

  return (
    <EnterpriseRouteGuard>
      <div className="space-y-6">
        <PageHeader
          title="گزارش‌ساز سفارشی و گزارش‌های تلفیقی"
          subtitle="ساخت و استخراج گزارش‌های پویا از اسناد حسابداری، فاکتورهای فروش و گزارش‌های تلفیقی با تراکنش فقط‌خواندنی و سقف ۵ ثانیه"
        />

        {error && <ErrorNotice message={error} />}

        {/* Dataset selector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">انتخاب مجموعه داده</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {datasets.map((ds) => (
                <button
                  key={ds.id}
                  type="button"
                  onClick={() => setSelectedDataset(ds.id)}
                  className={`p-4 rounded-lg border text-right transition-all ${
                    selectedDataset === ds.id
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="font-semibold text-sm">{ds.labelFa}</div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {ds.descriptionFa}
                  </div>
                </button>
              ))}
            </div>

            {/* Column selection pills */}
            {currentDataset && (
              <div className="pt-4 border-t space-y-2">
                <Label className="text-sm font-medium">ستون‌های گزارش</Label>
                <div className="flex flex-wrap gap-2">
                  {currentDataset.columns.map((c) => {
                    const active = selectedColumns.includes(c.id);
                    return (
                      <Badge
                        key={c.id}
                        variant={active ? "default" : "outline"}
                        className="cursor-pointer select-none py-1.5 px-3 text-xs"
                        onClick={() => toggleColumn(c.id)}
                      >
                        {c.labelFa}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Filters and action bar */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="w-4 h-4" /> فیلترهای گزارش
            </CardTitle>
            <Button variant="outline" size="sm" onClick={addFilter} className="gap-1.5 text-xs">
              <Plus className="w-3.5 h-3.5" /> افزودن فیلتر
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {filters.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground border border-dashed rounded-md">
                هیچ فیلتری تعریف نشده است (تمام داده‌ها خوانده می‌شوند).
              </div>
            ) : (
              <div className="space-y-2">
                {filters.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      className="border rounded px-2 py-1 text-xs bg-background h-8"
                      value={f.column}
                      onChange={(e) => updateFilter(i, { column: e.target.value })}
                    >
                      {currentDataset?.columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.labelFa}
                        </option>
                      ))}
                    </select>

                    <select
                      className="border rounded px-2 py-1 text-xs bg-background h-8"
                      value={f.op}
                      onChange={(e) => updateFilter(i, { op: e.target.value })}
                    >
                      <option value="eq">برابر با (=)</option>
                      <option value="neq">مخالف با (≠)</option>
                      <option value="contains">شامل متن</option>
                      <option value="gt">بزرگ‌تر از (&gt;)</option>
                      <option value="gte">بزرگ‌تر یا مساوی (&ge;)</option>
                      <option value="lt">کوچک‌تر از (&lt;)</option>
                      <option value="lte">کوچک‌تر یا مساوی (&le;)</option>
                      <option value="is_null">خالی بودن</option>
                      <option value="is_not_null">پر بودن</option>
                    </select>

                    <Input
                      placeholder="مقدار فیلتر..."
                      className="h-8 text-xs flex-1"
                      value={f.value}
                      onChange={(e) => updateFilter(i, { value: e.target.value })}
                    />

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeFilter(i)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t">
              <Button onClick={handleRunQuery} disabled={loading} className="gap-2 text-xs">
                {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                اجرای گزارش
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport("xlsx")}
                  disabled={loading}
                  className="gap-1.5 text-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> خروجی اکسل
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport("pdf")}
                  disabled={loading}
                  className="gap-1.5 text-xs"
                >
                  <FileText className="w-3.5 h-3.5" /> خروجی PDF
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results view */}
        {result && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                نتایج گزارش ({result.totalRows.toLocaleString("fa-IR")} سطر)
              </CardTitle>
              <Badge variant="secondary" className="text-xs">
                زمان اجرا: {result.durationMs} میلی‌ثانیه
              </Badge>
            </CardHeader>
            <CardContent>
              {result.rows.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  هیچ داده‌ای مطابق فیلترهای مشخص‌شده یافت نشد.
                </div>
              ) : (
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right w-12">#</TableHead>
                        {result.columns.map((c) => (
                          <TableHead key={c.id} className="text-right">
                            {c.labelFa}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.rows.map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                          {result.columns.map((c) => {
                            const val = row[c.id];
                            return (
                              <TableCell key={c.id} className="text-xs">
                                {c.type === "money" && val != null
                                  ? formatMoneyRial(Number(val) || 0)
                                  : String(val ?? "—")}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </EnterpriseRouteGuard>
  );
}
