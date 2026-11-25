"use client";

import { useState } from "react";
import { Calculator, FileSpreadsheet, Loader2, Plus, Trash2 } from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  previewBusinessTax,
  previewCorporateTax,
  previewDoctorWithholding,
  previewRentalTax,
} from "@/lib/api/tax-previews-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import type {
  BusinessTaxPreview,
  BusinessUnitDto,
  CorporateTaxPreview,
  DoctorPaymentDto,
  DoctorPaymentKind,
  DoctorWithholdingPreview,
  PartnerDto,
  RentalTaxPreview,
  StatutoryParameterUse,
} from "@/types/tax-previews";

type PreviewTab = "corporate" | "business" | "rental" | "doctor";

export default function TaxPreviewsPage() {
  const [activeTab, setActiveTab] = useState<PreviewTab>("corporate");

  return (
    <EnterpriseRouteGuard>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="پیش‌نمایش‌های مالیاتی"
          description="میز کار محاسبات و پیش‌نمایش ذخایر مالیاتی (ماده ۱۰۱، ماده ۵۳، درآمد شرکت‌ها و تکلیفی پزشکان — بدون ثبت سند)"
          icon={<Calculator className="h-6 w-6 text-primary" />}
        />

        <div role="tablist" aria-label="انواع پیش‌نمایش مالیاتی" className="flex flex-wrap gap-2">
          <Button
            id="tab-corporate"
            role="tab"
            aria-selected={activeTab === "corporate"}
            aria-controls="panel-corporate"
            variant={activeTab === "corporate" ? "default" : "outline"}
            className="min-h-[44px] min-w-[44px] px-4"
            onClick={() => setActiveTab("corporate")}
          >
            مالیات بر درآمد شرکت‌ها
          </Button>
          <Button
            id="tab-business"
            role="tab"
            aria-selected={activeTab === "business"}
            aria-controls="panel-business"
            variant={activeTab === "business" ? "default" : "outline"}
            className="min-h-[44px] min-w-[44px] px-4"
            onClick={() => setActiveTab("business")}
          >
            مشاغل و مشارکت (ماده ۱۰۱)
          </Button>
          <Button
            id="tab-rental"
            role="tab"
            aria-selected={activeTab === "rental"}
            aria-controls="panel-rental"
            variant={activeTab === "rental" ? "default" : "outline"}
            className="min-h-[44px] min-w-[44px] px-4"
            onClick={() => setActiveTab("rental")}
          >
            املاک و اجاره (ماده ۵۳ و ۵۷)
          </Button>
          <Button
            id="tab-doctor"
            role="tab"
            aria-selected={activeTab === "doctor"}
            aria-controls="panel-doctor"
            variant={activeTab === "doctor" ? "default" : "outline"}
            className="min-h-[44px] min-w-[44px] px-4"
            onClick={() => setActiveTab("doctor")}
          >
            تکلیفی حق‌الزحمه پزشکان
          </Button>
        </div>

        <div
          role="tabpanel"
          id="panel-corporate"
          aria-labelledby="tab-corporate"
          hidden={activeTab !== "corporate"}
        >
          {activeTab === "corporate" && <CorporateTaxWorkbench />}
        </div>

        <div
          role="tabpanel"
          id="panel-business"
          aria-labelledby="tab-business"
          hidden={activeTab !== "business"}
        >
          {activeTab === "business" && <BusinessTaxWorkbench />}
        </div>

        <div
          role="tabpanel"
          id="panel-rental"
          aria-labelledby="tab-rental"
          hidden={activeTab !== "rental"}
        >
          {activeTab === "rental" && <RentalTaxWorkbench />}
        </div>

        <div
          role="tabpanel"
          id="panel-doctor"
          aria-labelledby="tab-doctor"
          hidden={activeTab !== "doctor"}
        >
          {activeTab === "doctor" && <DoctorWithholdingWorkbench />}
        </div>
      </div>
    </EnterpriseRouteGuard>
  );
}

// =========================================================================
// ۱. پیش‌نمایش مالیات بر درآمد شرکت‌ها
// =========================================================================
function CorporateTaxWorkbench() {
  const [fiscalYear, setFiscalYear] = useState<number>(1405);
  const [accountingProfit, setAccountingProfit] = useState<string>("1000000000");
  const [nonDeductibleAdditions, setNonDeductibleAdditions] = useState<string>("0");
  const [exemptIncomeAndDeductions, setExemptIncomeAndDeductions] = useState<string>("0");
  const [lossesBroughtForward, setLossesBroughtForward] = useState<string>("0");
  const [expenseAccountCode, setExpenseAccountCode] = useState<string>("");
  const [payableAccountCode, setPayableAccountCode] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CorporateTaxPreview | null>(null);

  async function handleCalculate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await previewCorporateTax({
        fiscalYear: Number(fiscalYear),
        accountingProfit,
        nonDeductibleAdditions,
        exemptIncomeAndDeductions,
        lossesBroughtForward,
        expenseAccountCode: expenseAccountCode.trim() || undefined,
        payableAccountCode: payableAccountCode.trim() || undefined,
      });
      setResult(data);
    } catch (err) {
      setError(loadErrorMessage(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ورودی‌های محاسبه مالیات بر درآمد شرکت</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCalculate} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corp-fiscal-year">سال مالی (شمسی)</Label>
              <Input
                id="corp-fiscal-year"
                type="number"
                min={1300}
                max={1600}
                value={fiscalYear}
                onChange={(e) => setFiscalYear(Number(e.target.value))}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corp-profit">سود حسابداری قبل از مالیات (ریال)</Label>
              <Input
                id="corp-profit"
                value={accountingProfit}
                onChange={(e) => setAccountingProfit(e.target.value)}
                placeholder="مثلاً ۱۰۰۰۰۰۰۰۰۰"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corp-additions">اضافات غیرقابل قبول مالیاتی (ریال)</Label>
              <Input
                id="corp-additions"
                value={nonDeductibleAdditions}
                onChange={(e) => setNonDeductibleAdditions(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corp-exempt">درآمد معاف و کسورات قانونی (ریال)</Label>
              <Input
                id="corp-exempt"
                value={exemptIncomeAndDeductions}
                onChange={(e) => setExemptIncomeAndDeductions(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corp-losses">زیان سنواتی انتقالی (ریال)</Label>
              <Input
                id="corp-losses"
                value={lossesBroughtForward}
                onChange={(e) => setLossesBroughtForward(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corp-exp-code">کد معین هزینه مالیات (اختیاری)</Label>
              <Input
                id="corp-exp-code"
                value={expenseAccountCode}
                onChange={(e) => setExpenseAccountCode(e.target.value)}
                placeholder="مثلاً 8101"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corp-pay-code">کد معین ذخیره مالیات (اختیاری)</Label>
              <Input
                id="corp-pay-code"
                value={payableAccountCode}
                onChange={(e) => setPayableAccountCode(e.target.value)}
                placeholder="مثلاً 4101"
              />
            </div>
            <div className="flex items-end md:col-span-2 lg:col-span-2">
              <Button type="submit" disabled={loading} className="w-full sm:w-auto min-h-[44px]">
                {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Calculator className="me-2 h-4 w-4" />}
                محاسبه پیش‌نمایش
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <LoadingLine show={loading} />
      <ErrorNotice title="خطا در محاسبه پیش‌نمایش" message={error} />

      {result && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">درآمد مشمول مالیات</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">{formatMoneyRial(result.taxableIncome)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">مالیات بر اساس نرخ</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">{formatMoneyRial(result.taxByRate)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">کف حداقل مالیات مؤثر (۱۰٪)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">{formatMoneyRial(result.floorTax)}</div>
                {result.floorApplied && <Badge variant="secondary" className="mt-1">کف حداقل اعمال شد</Badge>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">ذخیره مالیات تعیین‌شده</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-primary">{formatMoneyRial(result.provision)}</div>
                {result.effectiveRate && (
                  <p className="text-xs text-muted-foreground mt-1">نرخ مؤثر: {result.effectiveRate}</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">برگه محاسباتی (Worksheet)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">ردیف</TableHead>
                      <TableHead>مرحله محاسباتی</TableHead>
                      <TableHead className="text-end">مبلغ (ریال)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.worksheet.map((step, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{formatNumber(idx + 1)}</TableCell>
                        <TableCell className="font-medium">{step.step}</TableCell>
                        <TableCell className="text-end font-mono">{formatMoneyRial(step.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {result.voucher.lines.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">پیش‌نمایش سند حسابداری (ثبت‌نشده)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>کد حساب</TableHead>
                        <TableHead>شرح ردیف سند</TableHead>
                        <TableHead className="text-end">بدهکار (ریال)</TableHead>
                        <TableHead className="text-end">بستانکار (ریال)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.voucher.lines.map((line, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono">{line.accountCode || "—"}</TableCell>
                          <TableCell>{line.description}</TableCell>
                          <TableCell className="text-end font-mono">{formatMoneyRial(line.debit)}</TableCell>
                          <TableCell className="text-end font-mono">{formatMoneyRial(line.credit)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          <NotesAndParameters notes={result.notes} parameters={result.parameters} />
        </div>
      )}
    </div>
  );
}

// =========================================================================
// ۲. پیش‌نمایش مالیات مشاغل و مشارکت مدنی (ماده ۱۰۱)
// =========================================================================
function BusinessTaxWorkbench() {
  const [fiscalYear, setFiscalYear] = useState<number>(1405);
  const [mode, setMode] = useState<"SOLE" | "PARTNERSHIP">("SOLE");
  const [units, setUnits] = useState<BusinessUnitDto[]>([
    { revenue: "5000000000", deductibleExpenses: "3000000000" },
  ]);
  const [partners, setPartners] = useState<PartnerDto[]>([
    { name: "شریک اول", shareBps: 5000 },
    { name: "شریک دوم", shareBps: 5000 },
  ]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BusinessTaxPreview | null>(null);

  function addUnit() {
    setUnits([...units, { revenue: "0", deductibleExpenses: "0" }]);
  }

  function removeUnit(index: number) {
    if (units.length <= 1) return;
    setUnits(units.filter((_, i) => i !== index));
  }

  function updateUnit(index: number, field: keyof BusinessUnitDto, value: string) {
    setUnits(units.map((u, i) => (i === index ? { ...u, [field]: value } : u)));
  }

  function addPartner() {
    setPartners([...partners, { name: "", shareBps: 0 }]);
  }

  function removePartner(index: number) {
    if (partners.length <= 2) return;
    setPartners(partners.filter((_, i) => i !== index));
  }

  function updatePartner<K extends keyof PartnerDto>(index: number, field: K, value: PartnerDto[K]) {
    setPartners(partners.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  }

  async function handleCalculate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await previewBusinessTax({
        fiscalYear: Number(fiscalYear),
        mode,
        units,
        partners: mode === "PARTNERSHIP" ? partners : undefined,
      });
      setResult(data);
    } catch (err) {
      setError(loadErrorMessage(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ورودی‌های محاسبه مالیات مشاغل (ماده ۱۰۱)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCalculate} className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="biz-fiscal-year">سال مالی (شمسی)</Label>
                <Input
                  id="biz-fiscal-year"
                  type="number"
                  min={1300}
                  max={1600}
                  value={fiscalYear}
                  onChange={(e) => setFiscalYear(Number(e.target.value))}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="biz-mode">نوع مؤدی</Label>
                <select
                  id="biz-mode"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "SOLE" | "PARTNERSHIP")}
                >
                  <option value="SOLE">انفرادی (یک صاحب شغل)</option>
                  <option value="PARTNERSHIP">مشارکت مدنی (چند شریک)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">واحدهای کسب‌وکار (ماده ۱۰۱ تبصره ۲)</Label>
                <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={addUnit}>
                  <Plus className="me-1 h-3.5 w-3.5" /> افزودن واحد
                </Button>
              </div>
              {units.map((unit, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="flex-1">
                    <Input
                      aria-label="درآمد ناخالص واحد (ریال)"
                      placeholder="درآمد ناخالص واحد (ریال)"
                      className="h-11 min-h-[44px]"
                      value={unit.revenue}
                      onChange={(e) => updateUnit(idx, "revenue", e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex-1">
                    <Input
                      aria-label="هزینه‌های قابل قبول (ریال)"
                      placeholder="هزینه‌های قابل قبول (ریال)"
                      className="h-11 min-h-[44px]"
                      value={unit.deductibleExpenses}
                      onChange={(e) => updateUnit(idx, "deductibleExpenses", e.target.value)}
                      required
                    />
                  </div>
                  {units.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 min-h-[44px] min-w-[44px]"
                      onClick={() => removeUnit(idx)}
                      aria-label="حذف واحد"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {mode === "PARTNERSHIP" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">شرکا و درصد تسهیم (مجموع ۱۰٬۰۰۰ سهم = ۱۰۰٪)</Label>
                  <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={addPartner}>
                    <Plus className="me-1 h-3.5 w-3.5" /> افزودن شریک
                  </Button>
                </div>
                {partners.map((partner, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[140px]">
                      <Input
                        aria-label="نام شریک"
                        placeholder="نام شریک"
                        className="h-11 min-h-[44px]"
                        value={partner.name || ""}
                        onChange={(e) => updatePartner(idx, "name", e.target.value)}
                      />
                    </div>
                    <div className="w-32">
                      <Input
                        aria-label="سهم (از ۱۰٬۰۰۰)"
                        type="number"
                        placeholder="سهم (از ۱۰٬۰۰۰)"
                        className="h-11 min-h-[44px]"
                        value={partner.shareBps}
                        onChange={(e) => updatePartner(idx, "shareBps", Number(e.target.value))}
                        required
                      />
                    </div>
                    <div className="w-32">
                      <Input
                        aria-label="شناسه زوج"
                        placeholder="شناسه زوج"
                        className="h-11 min-h-[44px]"
                        value={partner.spouseGroup || ""}
                        onChange={(e) => updatePartner(idx, "spouseGroup", e.target.value)}
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground min-h-[44px]">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={partner.isHusband || false}
                        onChange={(e) => updatePartner(idx, "isHusband", e.target.checked)}
                      />
                      شوهر (دریافت معافیت)
                    </label>
                    {partners.length > 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 min-h-[44px] min-w-[44px]"
                        onClick={() => removePartner(idx)}
                        aria-label="حذف شریک"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div>
              <Button type="submit" disabled={loading} className="w-full sm:w-auto min-h-[44px]">
                {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Calculator className="me-2 h-4 w-4" />}
                محاسبه پیش‌نمایش مشاغل
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <LoadingLine show={loading} />
      <ErrorNotice title="خطا در محاسبه پیش‌نمایش" message={error} />

      {result && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">مجموع درآمد مشمول</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">{formatMoneyRial(result.totalIncome)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">تعداد معافیت‌های استفاده‌شده</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">{formatNumber(result.exemptionsUsed)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">مالیات کل برآوردشده</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-primary">{formatMoneyRial(result.totalTax)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">سهم و مالیات هر مؤدی / شریک</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>عنوان مؤدی</TableHead>
                      <TableHead className="text-end">سهم درآمد (ریال)</TableHead>
                      <TableHead className="text-end">معافیت تخصیصی (ریال)</TableHead>
                      <TableHead className="text-end">درآمد مشمول مالیات (ریال)</TableHead>
                      <TableHead className="text-end">مالیات محاسبه‌شده (ریال)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.taxpayers.map((t, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{t.label}</TableCell>
                        <TableCell className="text-end font-mono">{formatMoneyRial(t.incomeShare)}</TableCell>
                        <TableCell className="text-end font-mono">{formatMoneyRial(t.exemption)}</TableCell>
                        <TableCell className="text-end font-mono">{formatMoneyRial(t.taxableIncome)}</TableCell>
                        <TableCell className="text-end font-mono font-bold text-primary">
                          {formatMoneyRial(t.tax)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <NotesAndParameters notes={result.notes} parameters={result.parameters} />
        </div>
      )}
    </div>
  );
}

// =========================================================================
// ۳. پیش‌نمایش مالیات بر درآمد اجاره (ماده ۵۳ و ۵۷)
// =========================================================================
function RentalTaxWorkbench() {
  const [fiscalYear, setFiscalYear] = useState<number>(1405);
  const [rentReceived, setRentReceived] = useState<string>("600000000");
  const [inKindIncome, setInKindIncome] = useState<string>("0");
  const [lessorIsOwner, setLessorIsOwner] = useState<boolean>(true);
  const [rentPaid, setRentPaid] = useState<string>("0");
  const [exemptRentPortion, setExemptRentPortion] = useState<string>("0");
  const [otherTaxableIncome, setOtherTaxableIncome] = useState<string>("0");
  const [minorUnderGuardianship, setMinorUnderGuardianship] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RentalTaxPreview | null>(null);

  async function handleCalculate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await previewRentalTax({
        fiscalYear: Number(fiscalYear),
        rentReceived,
        inKindIncome: inKindIncome || "0",
        lessorIsOwner,
        rentPaid: !lessorIsOwner ? rentPaid : undefined,
        exemptRentPortion: exemptRentPortion || "0",
        otherTaxableIncome: otherTaxableIncome || "0",
        minorUnderGuardianship,
      });
      setResult(data);
    } catch (err) {
      setError(loadErrorMessage(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ورودی‌های محاسبه مالیات اجاره املاک</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCalculate} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rental-year">سال مالی (شمسی)</Label>
              <Input
                id="rental-year"
                type="number"
                min={1300}
                max={1600}
                value={fiscalYear}
                onChange={(e) => setFiscalYear(Number(e.target.value))}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rental-received">اجاره‌بهای دریافتی کل سال (ریال)</Label>
              <Input
                id="rental-received"
                value={rentReceived}
                onChange={(e) => setRentReceived(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rental-inkind">درآمد غیرنقدی / هزینه‌های انجام‌شده توسط مستأجر (ریال)</Label>
              <Input
                id="rental-inkind"
                value={inKindIncome}
                onChange={(e) => setInKindIncome(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rental-exempt">اجاره معاف (سکونت بستگان، تبصره ۱۱ و...) (ریال)</Label>
              <Input
                id="rental-exempt"
                value={exemptRentPortion}
                onChange={(e) => setExemptRentPortion(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rental-other">سایر درآمدهای مشمول مالیات سال (ریال)</Label>
              <Input
                id="rental-other"
                value={otherTaxableIncome}
                onChange={(e) => setOtherTaxableIncome(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-3 justify-center md:col-span-2 lg:col-span-1">
              <label className="flex items-center gap-2 text-sm min-h-[44px] cursor-pointer">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={lessorIsOwner}
                  onChange={(e) => setLessorIsOwner(e.target.checked)}
                />
                موجر مالک ملک است (کسر ۲۵٪ هزینه استهلاک)
              </label>
              {!lessorIsOwner && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rental-paid">اجاره پرداختی توسط موجر دست‌اول (ریال)</Label>
                  <Input
                    id="rental-paid"
                    className="h-11 min-h-[44px]"
                    value={rentPaid}
                    onChange={(e) => setRentPaid(e.target.value)}
                    required={!lessorIsOwner}
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-muted-foreground min-h-[44px] cursor-pointer">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={minorUnderGuardianship}
                  onChange={(e) => setMinorUnderGuardianship(e.target.checked)}
                />
                فرزند صغیر تحت ولایت پدر (تبصره ۱ ماده ۵۷، فاقد معافیت)
              </label>
            </div>

            <div className="flex items-end md:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={loading} className="w-full sm:w-auto min-h-[44px]">
                {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Calculator className="me-2 h-4 w-4" />}
                محاسبه پیش‌نمایش اجاره
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <LoadingLine show={loading} />
      <ErrorNotice title="خطا در محاسبه پیش‌نمایش" message={error} />

      {result && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">اجاره ناخالص</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">{formatMoneyRial(result.grossRent)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">درآمد مشمول پس از استهلاک</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">{formatMoneyRial(result.taxableRent)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">معافیت استفاده‌شده ماده ۵۷</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold">{formatMoneyRial(result.exemptionAmount)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">مالیات برآوردشده کل</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-primary">{formatMoneyRial(result.tax)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">برگه محاسباتی اجاره (Worksheet)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">ردیف</TableHead>
                      <TableHead>مرحله محاسباتی</TableHead>
                      <TableHead className="text-end">مبلغ (ریال)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.worksheet.map((step, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{formatNumber(idx + 1)}</TableCell>
                        <TableCell className="font-medium">{step.step}</TableCell>
                        <TableCell className="text-end font-mono">{formatMoneyRial(step.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <NotesAndParameters notes={result.notes} parameters={result.parameters} />
        </div>
      )}
    </div>
  );
}

// =========================================================================
// ۴. پیش‌نمایش مالیات تکلیفی حق‌الزحمه پزشکان
// =========================================================================
function DoctorWithholdingWorkbench() {
  const [fiscalYear, setFiscalYear] = useState<number>(1405);
  const [remittedOn, setRemittedOn] = useState<string>("");
  const [payments, setPayments] = useState<DoctorPaymentDto[]>([
    { paidOn: "2026-06-01", amount: "500000000", doctorRef: "DOC-01", kind: "FEE" },
  ]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DoctorWithholdingPreview | null>(null);

  function addPayment() {
    setPayments([...payments, { paidOn: "2026-06-01", amount: "0", doctorRef: "", kind: "FEE" }]);
  }

  function removePayment(index: number) {
    if (payments.length <= 1) return;
    setPayments(payments.filter((_, i) => i !== index));
  }

  function updatePayment<K extends keyof DoctorPaymentDto>(index: number, field: K, value: DoctorPaymentDto[K]) {
    setPayments(payments.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  }

  async function handleCalculate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await previewDoctorWithholding({
        fiscalYear: Number(fiscalYear),
        payments,
        remittedOn: remittedOn.trim() || undefined,
      });
      setResult(data);
    } catch (err) {
      setError(loadErrorMessage(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ورودی‌های محاسبه مالیات تکلیفی پزشکان (۱۰٪ علی‌الحساب)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCalculate} className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-fiscal-year">سال مالی (شمسی)</Label>
                <Input
                  id="doc-fiscal-year"
                  type="number"
                  min={1300}
                  max={1600}
                  value={fiscalYear}
                  onChange={(e) => setFiscalYear(Number(e.target.value))}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-remitted-on">تاریخ ایصال / پرداخت به مالیات (اختیاری - برآورد جریمه تأخیر)</Label>
                <Input
                  id="doc-remitted-on"
                  type="date"
                  value={remittedOn}
                  onChange={(e) => setRemittedOn(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">پرداخت‌ها به کادر درمانی</Label>
                <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={addPayment}>
                  <Plus className="me-1 h-3.5 w-3.5" /> افزودن پرداخت
                </Button>
              </div>

              {payments.map((p, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-3">
                  <div className="w-36">
                    <Input
                      aria-label="تاریخ پرداخت"
                      type="date"
                      className="h-11 min-h-[44px]"
                      value={p.paidOn}
                      onChange={(e) => updatePayment(idx, "paidOn", e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <Input
                      aria-label="شناسه یا نام پزشک"
                      placeholder="شناسه / نام پزشک"
                      className="h-11 min-h-[44px]"
                      value={p.doctorRef}
                      onChange={(e) => updatePayment(idx, "doctorRef", e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <Input
                      aria-label="مبلغ ناخالص (ریال)"
                      placeholder="مبلغ ناخالص (ریال)"
                      className="h-11 min-h-[44px]"
                      value={p.amount}
                      onChange={(e) => updatePayment(idx, "amount", e.target.value)}
                      required
                    />
                  </div>
                  <div className="w-36">
                    <select
                      aria-label="نوع پرداخت"
                      className="h-11 min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={p.kind}
                      onChange={(e) => updatePayment(idx, "kind", e.target.value as DoctorPaymentKind)}
                    >
                      <option value="FEE">حق‌الزحمه (FEE)</option>
                      <option value="SALARY">حقوق استخدامی</option>
                      <option value="BONUS">کارانه مصوب</option>
                    </select>
                  </div>
                  {payments.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 min-h-[44px] min-w-[44px]"
                      onClick={() => removePayment(idx)}
                      aria-label="حذف پرداخت"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div>
              <Button type="submit" disabled={loading} className="w-full sm:w-auto min-h-[44px]">
                {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Calculator className="me-2 h-4 w-4" />}
                محاسبه پیش‌نمایش کسر علی‌الحساب
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <LoadingLine show={loading} />
      <ErrorNotice title="خطا در محاسبه پیش‌نمایش" message={error} />

      {result && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">کل مالیات تکلیفی مکسوره</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-primary">{formatMoneyRial(result.totalWithheld)}</div>
              </CardContent>
            </Card>
            {result.latePenalty && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">
                    جریمه تأخیر ماده ۱۹۹ ({formatNumber(result.latePenalty.monthsLate)} ماه تأخیر)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold text-destructive">
                    {formatMoneyRial(result.latePenalty.amount)}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">جزئیات پرداخت‌ها و کسورات</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>پزشک</TableHead>
                      <TableHead>نوع</TableHead>
                      <TableHead>تاریخ پرداخت</TableHead>
                      <TableHead className="text-end">مبلغ ناخالص (ریال)</TableHead>
                      <TableHead className="text-end">مالیات مکسوره (ریال)</TableHead>
                      <TableHead className="text-end">خالص پرداختی (ریال)</TableHead>
                      <TableHead>مهلت ایصال</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.lines.map((line, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{line.doctorRef}</TableCell>
                        <TableCell>
                          <Badge variant={line.kind === "FEE" ? "default" : "secondary"}>
                            {line.kind === "FEE" ? "حق‌الزحمه" : line.kind === "SALARY" ? "حقوق" : "کارانه"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{line.paidOn}</TableCell>
                        <TableCell className="text-end font-mono">{formatMoneyRial(line.amount)}</TableCell>
                        <TableCell className="text-end font-mono font-bold text-primary">
                          {formatMoneyRial(line.withheld)}
                        </TableCell>
                        <TableCell className="text-end font-mono">{formatMoneyRial(line.netToDoctor)}</TableCell>
                        <TableCell className="font-mono text-xs">{line.remitBy}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <NotesAndParameters notes={result.notes} parameters={result.parameters} />
        </div>
      )}
    </div>
  );
}

// =========================================================================
// مولفه مشترک یادداشت‌های حقوقی و پارامترهای استخراج‌شده
// =========================================================================
function NotesAndParameters({
  notes,
  parameters,
}: {
  notes: string[];
  parameters: StatutoryParameterUse[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {notes.length > 0 && (
        <Alert>
          <AlertTitle className="text-sm font-semibold">توضیحات و مستندات قانونی</AlertTitle>
          <AlertDescription>
            <ul className="list-disc ps-5 text-xs text-muted-foreground space-y-1 mt-2">
              {notes.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {parameters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">پارامترهای قانونی خوانده‌شده از سامانه</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>کلید پارامتر</TableHead>
                    <TableHead>تاریخ اجرا</TableHead>
                    <TableHead>منبع</TableHead>
                    <TableHead>وضعیت تأیید رسمی</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parameters.map((param, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs">{param.key}</TableCell>
                      <TableCell className="font-mono text-xs">{param.effectiveFrom}</TableCell>
                      <TableCell className="text-xs">{param.source || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={param.verified ? "default" : "outline"} className="text-xs">
                          {param.verified ? "تأییدشده رسمی" : "برآورد / نیازمند تأیید"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
