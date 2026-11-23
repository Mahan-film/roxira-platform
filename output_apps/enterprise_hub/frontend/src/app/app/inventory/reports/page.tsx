"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Boxes, Download, FileSpreadsheet, FileText, Loader2, Warehouse } from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { API_PROXY_BASE_PATH, INVENTORY_RESOURCE_PATH } from "@/lib/api/config";
import {
  getCardexReport,
  getStockBalanceReport,
  listStockItems,
  listWarehouses,
} from "@/lib/api/inventory-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import type {
  CardexReportResponse,
  StockBalanceReportResponse,
  StockItem,
  Warehouse as WarehouseModel,
} from "@/types/inventory";

type StockReportTab = "cardex" | "balance";

export default function InventoryReportsPage() {
  const [activeTab, setActiveTab] = useState<StockReportTab>("cardex");
  const [warehouses, setWarehouses] = useState<WarehouseModel[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);

  useEffect(() => {
    listWarehouses().then(setWarehouses).catch(() => {});
    listStockItems({ limit: 100 }).then((res) => setStockItems(res.items)).catch(() => {});
  }, []);

  return (
    <EnterpriseRouteGuard>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="گزارش‌های انبار و کاردکس"
          description="کاردکس گردش کالا، موجودی انبارها و هشدارهای نقطه سفارش بر پایه ارزیابی FIFO"
          icon={<Boxes className="h-6 w-6 text-primary" />}
        />

        <div role="tablist" aria-label="بخش‌های گزارش انبار" className="flex flex-wrap gap-2">
          <Button
            id="tab-cardex"
            role="tab"
            aria-selected={activeTab === "cardex"}
            aria-controls="panel-cardex"
            variant={activeTab === "cardex" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("cardex")}
          >
            کاردکس کالا
          </Button>
          <Button
            id="tab-balance"
            role="tab"
            aria-selected={activeTab === "balance"}
            aria-controls="panel-balance"
            variant={activeTab === "balance" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("balance")}
          >
            موجودی انبار و هشدارهای سفارش
          </Button>
        </div>

        <div
          role="tabpanel"
          id="panel-cardex"
          aria-labelledby="tab-cardex"
          hidden={activeTab !== "cardex"}
        >
          {activeTab === "cardex" && <CardexSection warehouses={warehouses} stockItems={stockItems} />}
        </div>

        <div
          role="tabpanel"
          id="panel-balance"
          aria-labelledby="tab-balance"
          hidden={activeTab !== "balance"}
        >
          {activeTab === "balance" && <StockBalanceSection warehouses={warehouses} />}
        </div>
      </div>
    </EnterpriseRouteGuard>
  );
}

// =========================================================================
// بخش ۱: کاردکس کالا
// =========================================================================
function CardexSection({
  warehouses,
  stockItems,
}: {
  warehouses: WarehouseModel[];
  stockItems: StockItem[];
}) {
  const [sku, setSku] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CardexReportResponse | null>(null);

  // Set default SKU if items exist
  useEffect(() => {
    if (!sku && stockItems.length > 0) {
      setSku(stockItems[0].sku);
    }
  }, [stockItems, sku]);

  async function handleFetch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!sku.trim()) {
      setError("لطفاً شناسه کالا (SKU) را وارد یا انتخاب کنید.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getCardexReport({
        sku: sku.trim(),
        warehouseId: warehouseId ? Number(warehouseId) : undefined,
        from: from.trim() || undefined,
        to: to.trim() || undefined,
      });
      setReport(data);
    } catch (err) {
      setError(loadErrorMessage(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  function getExportUrl(format: "xlsx" | "pdf") {
    const params = new URLSearchParams({ sku: sku.trim() });
    if (warehouseId) params.set("warehouseId", warehouseId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("format", format);
    return `${API_PROXY_BASE_PATH}/${INVENTORY_RESOURCE_PATH}/reports/cardex?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">فیلترهای کاردکس کالا</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleFetch} className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-5 items-end">
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label htmlFor="cardex-sku">شناسه یا کد کالا (SKU)</Label>
              <div className="flex gap-2">
                <Input
                  id="cardex-sku"
                  placeholder="مثلاً SKU-1001"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  required
                />
                {stockItems.length > 0 && (
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-xs max-w-[130px]"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    aria-label="انتخاب از کالاهای موجود"
                  >
                    <option value="">انتخاب سریع…</option>
                    {stockItems.map((item) => (
                      <option key={item.sku} value={item.sku}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cardex-warehouse">انبار</Label>
              <select
                id="cardex-warehouse"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">همه انبارها</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cardex-from">از تاریخ</Label>
              <Input
                id="cardex-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cardex-to">تا تاریخ</Label>
              <Input
                id="cardex-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>

            <div className="sm:col-span-2 md:col-span-5 flex flex-wrap gap-2 justify-between items-center pt-2">
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Download className="ml-2 h-4 w-4" />}
                دریافت کاردکس
              </Button>

              {report && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={getExportUrl("xlsx")} target="_blank" rel="noopener noreferrer">
                      <FileSpreadsheet className="ml-1.5 h-4 w-4" /> خروجی اکسل
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={getExportUrl("pdf")} target="_blank" rel="noopener noreferrer">
                      <FileText className="ml-1.5 h-4 w-4" /> خروجی PDF
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <LoadingLine show={loading} />
      <ErrorNotice title="خطا در دریافت کاردکس" message={error} />

      {report && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">کالای انتخابی</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-base font-bold">{report.itemName}</div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5">{report.sku}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">مانده اول دوره</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">{formatNumber(Number(report.opening.quantity))} عدد</div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5">
                  ارزش: {formatMoneyRial(report.opening.value)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">مانده پایان دوره</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-primary">{formatNumber(Number(report.closing.quantity))} عدد</div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5">
                  ارزش: {formatMoneyRial(report.closing.value)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">کسری مقدار (Shortage)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">
                  {formatNumber(Number(report.shortageQty))} عدد
                </div>
                {Number(report.shortageQty) > 0 && (
                  <Badge variant="destructive" className="mt-1">دارای کسری انبار</Badge>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">گردش اسناد کاردکس</CardTitle>
            </CardHeader>
            <CardContent>
              {report.rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  هیچ گردش مقداری در بازه انتخابی برای این کالا ثبت نشده است.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">ردیف</TableHead>
                      <TableHead>تاریخ</TableHead>
                      <TableHead>شماره سند</TableHead>
                      <TableHead className="text-left">وارده</TableHead>
                      <TableHead className="text-left">صادره</TableHead>
                      <TableHead className="text-left">بهای واحد (ریال)</TableHead>
                      <TableHead className="text-left">مانده مقدار</TableHead>
                      <TableHead className="text-left">مانده ارزش (ریال)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{formatNumber(idx + 1)}</TableCell>
                        <TableCell className="font-mono text-xs">{row.date}</TableCell>
                        <TableCell className="font-mono text-xs">{row.document}</TableCell>
                        <TableCell className="text-left font-mono">{formatNumber(Number(row.inQty))}</TableCell>
                        <TableCell className="text-left font-mono">{formatNumber(Number(row.outQty))}</TableCell>
                        <TableCell className="text-left font-mono">{formatMoneyRial(row.unitCost)}</TableCell>
                        <TableCell className="text-left font-mono font-semibold">{formatNumber(Number(row.runningQty))}</TableCell>
                        <TableCell className="text-left font-mono font-bold text-primary">{formatMoneyRial(row.runningValue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// بخش ۲: موجودی انبارها و هشدارهای سفارش
// =========================================================================
function StockBalanceSection({ warehouses }: { warehouses: WarehouseModel[] }) {
  const [asOf, setAsOf] = useState<string>("");
  const [view, setView] = useState<"balance" | "reorder">("balance");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<StockBalanceReportResponse | null>(null);

  async function handleFetch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await getStockBalanceReport({
        asOf: asOf.trim() || undefined,
        view,
      });
      setReport(data);
    } catch (err) {
      setError(loadErrorMessage(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    handleFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function getExportUrl(format: "xlsx" | "pdf") {
    const params = new URLSearchParams({ view });
    if (asOf) params.set("asOf", asOf);
    params.set("format", format);
    return `${API_PROXY_BASE_PATH}/${INVENTORY_RESOURCE_PATH}/reports/stock-balance?${params.toString()}`;
  }

  const warehouseMap = new Map<string, string>(warehouses.map((w) => [String(w.id), w.name]));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">فیلترهای موجودی و هشدار سفارش</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleFetch} className="grid grid-cols-1 gap-4 sm:grid-cols-3 items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="balance-view">حالت نمایش</Label>
              <select
                id="balance-view"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={view}
                onChange={(e) => setView(e.target.value as "balance" | "reorder")}
              >
                <option value="balance">موجودی کلیه کالاها و انبارها</option>
                <option value="reorder">هشدارهای نقطه سفارش (کالاهای نیازمند خرید)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="balance-asof">تا تاریخ (پیش‌فرض امروز)</Label>
              <Input
                id="balance-asof"
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Download className="ml-2 h-4 w-4" />}
                به‌روزرسانی
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <LoadingLine show={loading} />
      <ErrorNotice title="خطا در دریافت موجودی" message={error} />

      {report && (
        <div className="flex flex-col gap-6">
          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              تاریخ مبنا: <span className="font-mono font-medium text-foreground">{report.asOf}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={getExportUrl("xlsx")} target="_blank" rel="noopener noreferrer">
                  <FileSpreadsheet className="ml-1.5 h-4 w-4" /> خروجی اکسل
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={getExportUrl("pdf")} target="_blank" rel="noopener noreferrer">
                  <FileText className="ml-1.5 h-4 w-4" /> خروجی PDF
                </a>
              </Button>
            </div>
          </div>

          {view === "reorder" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-destructive" />
                  هشدارهای نقطه سفارش (کسری موجودی)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {report.alerts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    تمامی کالاها بالاتر از نقطه سفارش قرار دارند و کسری مقداری وجود ندارد.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">ردیف</TableHead>
                        <TableHead>شناسه کالا</TableHead>
                        <TableHead className="text-left">موجودی فعلی</TableHead>
                        <TableHead className="text-left">نقطه سفارش</TableHead>
                        <TableHead className="text-left text-destructive font-bold">کسری سفارش</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.alerts.map((alert, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{formatNumber(idx + 1)}</TableCell>
                          <TableCell className="font-mono font-medium">{alert.itemId}</TableCell>
                          <TableCell className="text-left font-mono">{formatNumber(Number(alert.quantity))}</TableCell>
                          <TableCell className="text-left font-mono">{formatNumber(Number(alert.reorderPoint))}</TableCell>
                          <TableCell className="text-left font-mono font-bold text-destructive">
                            {formatNumber(Number(alert.shortfall))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">موجودی به تفکیک کالا و انبار</CardTitle>
              </CardHeader>
              <CardContent>
                {report.lines.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    هیچ موجودی ثبتی برای انبارها یافت نشد.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">ردیف</TableHead>
                        <TableHead>شناسه کالا</TableHead>
                        <TableHead>انبار</TableHead>
                        <TableHead className="text-left">مقدار موجودی</TableHead>
                        <TableHead className="text-left">ارزش ریالی (FIFO)</TableHead>
                        <TableHead className="text-left">کسری</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.lines.map((line, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{formatNumber(idx + 1)}</TableCell>
                          <TableCell className="font-mono font-medium">{line.itemId}</TableCell>
                          <TableCell>{warehouseMap.get(line.warehouseId) ?? `انبار ${line.warehouseId}`}</TableCell>
                          <TableCell className="text-left font-mono font-semibold">
                            {formatNumber(Number(line.quantity))}
                          </TableCell>
                          <TableCell className="text-left font-mono font-bold text-primary">
                            {formatMoneyRial(line.value)}
                          </TableCell>
                          <TableCell className="text-left font-mono text-xs">
                            {Number(line.shortageQty) > 0 ? (
                              <span className="text-destructive font-bold">{formatNumber(Number(line.shortageQty))}</span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
