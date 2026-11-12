"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Key,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import {
  ErrorNotice,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { listInvoices } from "@/lib/api/invoicing-client";
import {
  getMoadianCredential,
  getMoadianStatus,
  getMoadianSubmission,
  listMoadianSubmissions,
  putMoadianCredential,
  submitToMoadian,
} from "@/lib/api/moadian-seasonal-client";
import {
  generateKeyPair,
  getActiveSigningKey,
} from "@/lib/api/tax-compliance-client";
import { formatJalaliDate, formatMoneyRial } from "@/lib/fa-format";
import {
  MOADIAN_MAX_DEADLINE_DAYS,
  sortUnsentInvoicesByUrgency,
  type UnsentInvoiceInput,
} from "@/lib/moadian-send-deadline";
import {
  InvoiceDirection,
  InvoiceStatus,
  type InvoiceResponseDto,
} from "@/types/invoicing";
import {
  MOADIAN_SETTLEMENT_LABELS,
  MOADIAN_STATUS_LABELS,
  type MoadianCredentialResponseDto,
  type MoadianSettlementMethod,
  type MoadianStatusResponse,
  type MoadianSubmissionResponse,
} from "@/types/moadian-seasonal";
import type { SigningKeyResponseDto } from "@/types/tax-compliance";

const WIZARD_STEPS = [
  { id: 1, title: "۱. محیط آزمایشی (سندباکس)", desc: "ورود به سامانه آزمایشی سازمان" },
  { id: 2, title: "۲. زوج‌کلید و CSR", desc: "تولید کلید خصوصی و درخواست گواهی" },
  { id: 3, title: "۳. کارپوشه و ثبت اطلاعات", desc: "اخذ شناسه حافظه و ذخیره گواهی" },
  { id: 4, title: "۴. آزمون ارسال و استعلام", desc: "تست آنلاین ارسال صورتحساب" },
  { id: 5, title: "۵. محیط عملیاتی", desc: "چک‌لیست انتقال به سامانه اصلی" },
];

export default function MoadianWizardPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [status, setStatus] = useState<MoadianStatusResponse | null>(null);
  const [credential, setCredential] = useState<MoadianCredentialResponseDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // مرحله ۲: کلید و CSR
  const [cn, setCn] = useState("");
  const [org, setOrg] = useState("");
  const [ou, setOu] = useState("");
  const [econNumber, setEconNumber] = useState("");
  const [modulusLength, setModulusLength] = useState<2048 | 4096>(2048);
  const [generatedKey, setGeneratedKey] = useState<SigningKeyResponseDto | null>(null);
  const [generatedCsr, setGeneratedCsr] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);

  // مرحله ۳: ثبت اطلاعات مودیان
  const [memoryIdInput, setMemoryIdInput] = useState("");
  const [economicCodeInput, setEconomicCodeInput] = useState("");
  const [certPemInput, setCertPemInput] = useState("");
  const [privKeyPemInput, setPrivKeyPemInput] = useState("");
  const [useActiveSigningKey, setUseActiveSigningKey] = useState(false);
  const [defaultSstidInput, setDefaultSstidInput] = useState("");
  const [settlementMethodInput, setSettlementMethodInput] = useState<MoadianSettlementMethod>(1);
  const [savingCred, setSavingCred] = useState(false);

  // مرحله ۴: تست ارسال
  const [unsentInvoices, setUnsentInvoices] = useState<InvoiceResponseDto[]>([]);
  const [unsentLoadError, setUnsentLoadError] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [submittingInvoice, setSubmittingInvoice] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<MoadianSubmissionResponse | null>(null);
  const [pollingStatus, setPollingStatus] = useState(false);
  const [confirmProductionSubmit, setConfirmProductionSubmit] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetIdRef = useRef<string | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const isSandbox =
    !!credential?.baseUrl &&
    (credential.baseUrl.toLowerCase().includes("sandbox") ||
      credential.baseUrl.toLowerCase().includes("test"));

  // بخش پایش مهلت ارسال (آستانه دلخواه واردشده توسط کاربر؛ بدون پیش‌فرض قانونی)
  const [deadlineDays, setDeadlineDays] = useState<number | null>(null);

  const fetchStatusAndCreds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, cr, activeKey] = await Promise.all([
        getMoadianStatus().catch(() => null),
        getMoadianCredential().catch(() => null),
        getActiveSigningKey().catch(() => null),
      ]);
      setStatus(st);
      setCredential(cr);
      if (activeKey) {
        setGeneratedKey((prev) => prev ?? activeKey);
        if (activeKey.certificateRequestPem) {
          setGeneratedCsr((prev) => prev ?? activeKey.certificateRequestPem);
        }
        setUseActiveSigningKey(true);
      }
      if (cr) {
        setMemoryIdInput(cr.memoryId || "");
        setEconomicCodeInput(cr.economicCode || "");
        if (cr.defaultSstid) setDefaultSstidInput(cr.defaultSstid);
        if (cr.settlementMethod) {
          setSettlementMethodInput(Number(cr.settlementMethod) as MoadianSettlementMethod);
        }
      }
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUnsentInvoices = useCallback(async () => {
    setUnsentLoadError(null);
    try {
      const submissions = await listMoadianSubmissions();
      const completedOrInFlight = new Set(
        submissions
          .filter((s) => s.status === "QUEUED" || s.status === "SENT" || s.status === "SUCCESS")
          .map((s) => s.invoiceId),
      );

      let allIssuedInvoices: InvoiceResponseDto[] = [];
      let page = 1;
      const limit = 100;
      let total = 0;
      do {
        const res = await listInvoices({ status: InvoiceStatus.ISSUED, page, limit });
        allIssuedInvoices = allIssuedInvoices.concat(res.data);
        total = res.total ?? allIssuedInvoices.length;
        page++;
      } while (allIssuedInvoices.length < total && page <= 20);

      const pendingSales = allIssuedInvoices.filter(
        (inv) => inv.direction === InvoiceDirection.SALE && !completedOrInFlight.has(inv.id),
      );
      setUnsentInvoices(pendingSales);
      if (pendingSales.length > 0) {
        setSelectedInvoiceId((prev) =>
          prev && pendingSales.some((inv) => inv.id === prev) ? prev : pendingSales[0].id,
        );
      } else {
        setSelectedInvoiceId("");
      }
    } catch (err) {
      // Fail closed: بدون تأیید سوابق ارسال سامانه مودیان، فهرست ارسال‌نشده نمایش داده نمی‌شود تا از ارسال تکراری جلوگیری گردد
      setUnsentInvoices([]);
      setSelectedInvoiceId("");
      setUnsentLoadError(loadErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => {
      void fetchStatusAndCreds();
      void loadUnsentInvoices();
    });
  }, [fetchStatusAndCreds, loadUnsentInvoices]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // تولید زوج‌کلید و CSR
  const handleGenerateKeyAndCsr = async () => {
    setGeneratingKey(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const commonName = cn.trim();
      if (!commonName) {
        throw new Error("نام عمومی (Common Name) برای تولید فایل CSR الزامی است.");
      }

      const subject = {
        commonName,
        organization: org.trim() || undefined,
        organizationalUnit: ou.trim() || undefined,
        country: "IR",
        serialNumber: econNumber.trim() || undefined,
      };

      const keyRes = await generateKeyPair({
        modulusLength,
        subject,
      });

      setGeneratedKey(keyRes);
      setGeneratedCsr(keyRes.certificateRequestPem ?? null);
      setUseActiveSigningKey(true);
      setSuccessMsg("زوج‌کلید مالیاتی و فایل CSR با موفقیت تولید شدند.");
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setGeneratingKey(false);
    }
  };

  // ذخیره اطلاعات مودیان
  const handleSaveCredential = async () => {
    setSavingCred(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const memId = memoryIdInput.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(memId)) {
        throw new Error("شناسه حافظه مالیاتی باید دقیقاً ۶ کاراکتر (حروف/اعداد انگلیسی) باشد.");
      }
      const econ = economicCodeInput.trim();
      if (!/^\d{11,14}$/.test(econ)) {
        throw new Error("شماره اقتصادی باید بین ۱۱ تا ۱۴ رقم باشد.");
      }
      if (!certPemInput.includes("-----BEGIN CERTIFICATE-----")) {
        throw new Error("گواهی باید دارای قالب معتبر PEM (شامل -----BEGIN CERTIFICATE-----) باشد.");
      }
      const trimmedKey = privKeyPemInput.trim();
      if (!useActiveSigningKey && !trimmedKey.includes("PRIVATE KEY-----")) {
        throw new Error("کلید خصوصی باید دارای قالب معتبر PEM باشد یا گزینه کلید فعال سرور را انتخاب کنید.");
      }

      const updated = await putMoadianCredential({
        memoryId: memId,
        economicCode: econ,
        certificatePem: certPemInput.trim(),
        useActiveSigningKey: useActiveSigningKey && !trimmedKey ? true : undefined,
        privateKeyPem: trimmedKey || undefined,
        defaultSstid: defaultSstidInput.trim() || undefined,
        settlementMethod: settlementMethodInput,
      });

      setCredential(updated);
      setPrivKeyPemInput(""); // Clear private key from React memory after successful save
      setSuccessMsg("اطلاعات اتصال به سامانه مودیان با موفقیت ذخیره و اعتبارسنجی شد.");
      await fetchStatusAndCreds();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setSavingCred(false);
    }
  };

  // ارسال تست فاکتور به مودیان
  const handleTestSubmit = async () => {
    if (!selectedInvoiceId) return;
    const targetId = selectedInvoiceId;
    targetIdRef.current = targetId;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setSubmittingInvoice(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const sub = await submitToMoadian(targetId);
      if (!isMountedRef.current || targetIdRef.current !== targetId) return;
      setSubmissionResult(sub);
      setSuccessMsg("صورتحساب در صف ارسال سامانه مودیان قرار گرفت.");

      // استعلام وضعیت
      setPollingStatus(true);
      let attempts = 0;
      const poll = () => {
        pollTimerRef.current = setTimeout(async () => {
          if (!isMountedRef.current || targetIdRef.current !== targetId) return;
          try {
            attempts++;
            const current = await getMoadianSubmission(targetId);
            if (!isMountedRef.current || targetIdRef.current !== targetId) return;
            setSubmissionResult(current);
            if (
              current.status === "SUCCESS" ||
              current.status === "FAILED" ||
              current.status === "ERROR" ||
              attempts >= 10
            ) {
              setPollingStatus(false);
              pollTimerRef.current = null;
              if (current.status === "SUCCESS") {
                void loadUnsentInvoices();
              }
            } else {
              poll();
            }
          } catch {
            if (isMountedRef.current) {
              setPollingStatus(false);
              pollTimerRef.current = null;
            }
          }
        }, 3000);
      };
      poll();
    } catch (err) {
      if (isMountedRef.current) {
        setError(loadErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setSubmittingInvoice(false);
      }
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSuccessMsg(`${label} با موفقیت در کلیپ‌بورد کپی شد.`);
    } catch {
      setError("خطا در کپی در کلیپ‌بورد");
    }
  };

  const downloadTextFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // محاسبات مهلت قانونی برای صورتحساب‌های معوق
  const unsentInvoiceInputs: UnsentInvoiceInput[] = unsentInvoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.taxInvoiceNumber,
    issueDate: inv.issuedAt || inv.createdAt,
    total: inv.finalPayable,
    buyerName: inv.buyerInfo?.name ?? "خریدار عمومی",
    status: inv.status,
    direction: inv.direction,
  }));

  const rankedUnsent = sortUnsentInvoicesByUrgency(
    unsentInvoiceInputs,
    deadlineDays,
    new Date(),
  );

  const urgentCount = rankedUnsent.filter((r) => r.deadline.isUrgent).length;
  const expiredCount = rankedUnsent.filter((r) => r.deadline.isExpired).length;

  return (
    <EnterpriseRouteGuard requireAdmin>
      <div className="flex flex-col gap-6 p-4 sm:p-6" dir="rtl">
        {/* هدر صفحه */}
        <PageHeader
          title="ویزارد راه‌اندازی سامانه مؤدیان"
          description="راهنمای جامع و گام‌به‌گام راه‌اندازی، اتصال آزمایشی، بارگذاری گواهی‌ها، تست ارسال و پایش مهلت ارسال صورتحساب‌ها."
          icon={<Sparkles className="h-6 w-6 text-primary" />}
          actions={
            <div className="flex items-center gap-2">
              <Link
                href="/app/tax"
                className={buttonVariants({ variant: "outline", size: "sm", className: "gap-1" })}
              >
                <ArrowRight className="h-4 w-4" />
                بازگشت به پنل مالیات
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void fetchStatusAndCreds()}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          }
        />

        {/* وضعیت کلی اتصال و خلاصه */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardDescription>اتصال زنده (MOADIAN_ENABLED)</CardDescription>
              <CardTitle className="text-lg">
                {status?.enabled ? (
                  <Badge variant="default" className="bg-emerald-600 text-white">فعال و آماده اتصال</Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-500 text-amber-600">غیرفعال در سرور</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              پاسخ سرویس مودیان از طریق صف پیام BullMQ و کنترلر اختصاصی هدایت می‌شود.
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardDescription>اطلاعات گواهی و کلید مودیان</CardDescription>
              <CardTitle className="text-lg">
                {credential ? (
                  <Badge variant="default" className="bg-emerald-600 text-white">
                    شناسه: {credential.memoryId}
                  </Badge>
                ) : (
                  <Badge variant="destructive">ثبت نشده</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {credential
                ? `شماره اقتصادی: ${credential.economicCode} | روش تسویه: ${MOADIAN_SETTLEMENT_LABELS[Number(credential.settlementMethod) as MoadianSettlementMethod] ?? credential.settlementMethod}`
                : "برای ارسال معتبر فاکتورها، تکمیل مرحله ۳ الزامی است."}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardDescription>
                {deadlineDays !== null
                  ? `پایش مهلت ارسال (آستانه ${deadlineDays} روز تقویمی)`
                  : "پایش مهلت ارسال (آستانه تنظیم نشده)"}
              </CardDescription>
              <CardTitle className="text-lg flex items-center gap-2">
                {unsentLoadError ? (
                  <Badge variant="destructive">خطا در استعلام ارسال‌ها</Badge>
                ) : deadlineDays === null ? (
                  <Badge variant="secondary">
                    {unsentInvoices.length} فاکتور در انتظار بررسی
                  </Badge>
                ) : expiredCount > 0 ? (
                  <Badge variant="destructive">
                    {expiredCount} فاکتور منقضی‌شده
                  </Badge>
                ) : urgentCount > 0 ? (
                  <Badge variant="outline" className="border-amber-500 text-amber-600">
                    {urgentCount} فاکتور فوری
                  </Badge>
                ) : (
                  <Badge variant="secondary">وضعیت مهلت‌ها عادی</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              بر اساس آستانه تقویمی واردشده توسط کاربر از تاریخ صدور (قوانین و مهلت‌های قانونی را از بخشنامه‌های سازمان امور مالیاتی پیگیری کنید).
            </CardContent>
          </Card>
        </div>

        {/* پیام‌های وضعیت */}
        {error && <ErrorNotice title="خطا" message={error} />}
        {successMsg && (
          <Alert className="border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>موفقیت</AlertTitle>
            <AlertDescription>{successMsg}</AlertDescription>
          </Alert>
        )}

        {/* نوار مراحل ویزارد */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
          {WIZARD_STEPS.map((step) => {
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setCurrentStep(step.id)}
                className={`flex flex-col text-right transition-colors ${
                  isActive
                    ? "text-primary font-semibold"
                    : isCompleted
                    ? "text-foreground hover:text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="flex items-center gap-1.5 text-sm">
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                        isActive
                          ? "bg-primary text-primary-foreground font-bold"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {step.id}
                    </span>
                  )}
                  <span>{step.title}</span>
                </div>
                <span className="text-xs text-muted-foreground hidden sm:inline mr-6">
                  {step.desc}
                </span>
              </button>
            );
          })}
        </div>

        {/* محتوای گام فعال */}
        <div className="flex flex-col gap-6">
          {/* گام ۱: سندباکس */}
          {currentStep === 1 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    <CardTitle>گام ۱: ثبت‌نام و ورود به محیط آزمایشی (سندباکس مودیان)</CardTitle>
                  </div>
                  <Badge variant="outline">پیش‌نیاز اولیه</Badge>
                </div>
                <CardDescription>
                  سامانه آزمایشی سازمان امور مالیاتی کشور جهت تست فنی، دریافت کلیدها و بررسی تطبیق صورتحساب بدون ریسک جریمه یا اثر مالیاتی ایجاد شده است.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm leading-relaxed">
                <div className="rounded-lg border bg-muted/40 p-4 flex flex-col gap-3">
                  <h4 className="font-semibold text-foreground flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 text-primary" />
                    آدرس درگاه آزمایشی مودیان:
                  </h4>
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      href="https://sandboxrc.tax.gov.ir"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline font-mono text-base font-medium flex items-center gap-1.5"
                    >
                      https://sandboxrc.tax.gov.ir
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard("https://sandboxrc.tax.gov.ir", "آدرس سندباکس")}
                    >
                      <Copy className="h-3.5 w-3.5 ml-1" />
                      کپی پیوند
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="font-semibold text-foreground">اقدامات لازم در این مرحله:</h4>
                  <ul className="list-inside list-disc space-y-1.5 text-muted-foreground mr-2">
                    <li>ورود به درگاه سندباکس با استفاده از حساب کاربری تستی سازمان.</li>
                    <li>
                      در صورتی که هنوز ثبت‌نام نکرده‌اید، با استفاده از اطلاعات شرکت فرضی یا مشخصات اقتصادی تست، پرونده تشکیل دهید.
                    </li>
                    <li>
                      از منوی «عضویت و ثبت پایانه»، روش ارسال صورتحساب را روی <strong>«توسط مؤدی»</strong> تنظیم نمایید.
                    </li>
                    <li>
                      شناسه اقتصادی تست و شناسه ملی مودی آزمایشی خود را یادداشت کنید تا در گام‌های بعدی وارد کنید.
                    </li>
                  </ul>
                </div>

                <Alert className="border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle>نکته مهم امنیتی</AlertTitle>
                  <AlertDescription>
                    در محیط سندباکس، هرگز از کلید خصوصی و گواهی تجاری واقعی سازمان خود استفاده نکنید. در گام بعدی، یک زوج‌کلید مجزا و کاملاً امن اختصاصی توسط رکسایرا تولید می‌شود.
                  </AlertDescription>
                </Alert>
              </CardContent>
              <CardFooter className="flex justify-end gap-2 border-t pt-4">
                <Button onClick={() => setCurrentStep(2)} className="gap-2">
                  رفتن به گام ۲: تولید زوج‌کلید
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          )}

          {/* گام ۲: تولید زوج‌کلید و CSR */}
          {currentStep === 2 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="h-5 w-5 text-primary" />
                    <CardTitle>گام ۲: تولید زوج‌کلید RSA و گواهی الکترونیکی (CSR)</CardTitle>
                  </div>
                  <Badge variant="outline">الگوریتم RSA-2048 / PKCS#10</Badge>
                </div>
                <CardDescription>
                  سامانه مودیان نیازمند امضای بسته‌های داده با الگوریتم RS256 است. این فرم زوج‌کلید رمزنگاری را تولید و کلید خصوصی را در امنیت کامل (رمزنگاری AES-256-GCM در سرور) ذخیره می‌کند.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5 text-sm">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cn-input">نام عمومی (Common Name)</Label>
                    <Input
                      id="cn-input"
                      value={cn}
                      onChange={(e) => setCn(e.target.value)}
                      placeholder="مثال: Roxira Organization"
                    />
                    <p className="text-xs text-muted-foreground">نام انگلیسی سامانه یا هویت سازمانی.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="org-input">نام شرکت / سازمان (Organization)</Label>
                    <Input
                      id="org-input"
                      value={org}
                      onChange={(e) => setOrg(e.target.value)}
                      placeholder="نام رسمی شرکت"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ou-input">واحد سازمانی (Organizational Unit)</Label>
                    <Input
                      id="ou-input"
                      value={ou}
                      onChange={(e) => setOu(e.target.value)}
                      placeholder="امور مالیاتی"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="econ-input">شماره اقتصادی یا شناسه ملی (Serial Number)</Label>
                    <Input
                      id="econ-input"
                      value={econNumber}
                      onChange={(e) => setEconNumber(e.target.value)}
                      placeholder="کد ۱۱ تا ۱۴ رقمی"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Label>طول کلید:</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={modulusLength === 2048 ? "default" : "outline"}
                      onClick={() => setModulusLength(2048)}
                    >
                      2048 بیت (استاندارد مودیان)
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={modulusLength === 4096 ? "default" : "outline"}
                      onClick={() => setModulusLength(4096)}
                    >
                      4096 بیت (حداکثر امنیت)
                    </Button>
                  </div>
                </div>

                <div>
                  <Button
                    onClick={handleGenerateKeyAndCsr}
                    disabled={generatingKey}
                    className="gap-2"
                  >
                    <Key className="h-4 w-4" />
                    {generatingKey ? "در حال تولید زوج‌کلید امن…" : "تولید زوج‌کلید و فایل CSR"}
                  </Button>
                </div>

                {generatedKey && (
                  <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                      <div className="font-semibold flex items-center gap-1.5 text-foreground">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        زوج‌کلید جدید فعال شد
                      </div>
                      <Badge variant="outline" className="font-mono text-xs">
                        اثرانگشت: {generatedKey.keyFingerprint}
                      </Badge>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold">کلید عمومی (Public Key PEM) جهت آپلود در کارپوشه:</Label>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => copyToClipboard(generatedKey.publicKeyPem, "کلید عمومی")}
                          >
                            <Copy className="h-3 w-3 ml-1" />
                            کپی
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => downloadTextFile("public-key.pem", generatedKey.publicKeyPem)}
                          >
                            <Download className="h-3 w-3 ml-1" />
                            دانلود فایل public-key.pem
                          </Button>
                        </div>
                      </div>
                      <Textarea
                        readOnly
                        dir="ltr"
                        className="font-mono text-xs h-24 bg-background"
                        value={generatedKey.publicKeyPem}
                      />
                    </div>

                    {generatedCsr && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold">درخواست گواهی امضا (CSR PEM):</Label>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => copyToClipboard(generatedCsr, "درخواست گواهی (CSR)")}
                            >
                              <Copy className="h-3 w-3 ml-1" />
                              کپی
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => downloadTextFile("request.csr", generatedCsr)}
                            >
                              <Download className="h-3 w-3 ml-1" />
                              دانلود فایل request.csr
                            </Button>
                          </div>
                        </div>
                        <Textarea
                          readOnly
                          dir="ltr"
                          className="font-mono text-xs h-24 bg-background"
                          value={generatedCsr}
                        />
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-between border-t pt-4">
                <Button variant="outline" onClick={() => setCurrentStep(1)}>
                  بازگشت به گام ۱
                </Button>
                <Button onClick={() => setCurrentStep(3)} className="gap-2">
                  رفتن به گام ۳: ثبت در کارپوشه و رکسایرا
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          )}

          {/* گام ۳: بارگذاری در کارپوشه و ثبت در رکسایرا */}
          {currentStep === 3 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    <CardTitle>گام ۳: ثبت کلید در کارپوشه و تنظیم اطلاعات در رکسایرا</CardTitle>
                  </div>
                  <Badge variant="outline">PUT /moadian/credentials</Badge>
                </div>
                <CardDescription>
                  کلید عمومی را در کارپوشه آپلود نموده تا «شناسه یکتای حافظه مالیاتی» ۶ کاراکتری دریافت شود. سپس مقادیر را در این فرم ذخیره فرمایید.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5 text-sm">
                <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-xs leading-relaxed">
                  <h4 className="font-semibold text-foreground text-sm">مراحل در کارپوشه مالیاتی:</h4>
                  <ol className="list-inside list-decimal space-y-1 text-muted-foreground mr-1">
                    <li>ورود به کارپوشه مالیاتی (سندباکس یا عملیاتی) &larr; بخش مدیریت پرونده.</li>
                    <li>انتخاب «عضویت و ثبت پایانه» &larr; انتخاب روش ارسال: «توسط مؤدی».</li>
                    <li>آپلود فایل <code>public-key.pem</code> دانلودشده از گام قبل.</li>
                    <li>سامانه یک شناسه یکتای ۶ رقمی/حرفی به عنوان «شناسه حافظه مالیاتی» تولید و نمایش می‌دهد.</li>
                  </ol>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="mem-id-input">شناسه یکتای حافظه مالیاتی (Memory ID)</Label>
                    <Input
                      id="mem-id-input"
                      dir="ltr"
                      maxLength={6}
                      value={memoryIdInput}
                      onChange={(e) => setMemoryIdInput(e.target.value.toUpperCase())}
                      placeholder="مثال: A1B2C3"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">دقیقاً ۶ حرف و عدد انگلیسی بزرگ دریافتی از کارپوشه.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="econ-code-input">شماره اقتصادی فروشنده (Economic Code)</Label>
                    <Input
                      id="econ-code-input"
                      dir="ltr"
                      value={economicCodeInput}
                      onChange={(e) => setEconomicCodeInput(e.target.value)}
                      placeholder="۱۱ تا ۱۴ رقم"
                      className="font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="sstid-input">شناسه کالا/خدمت پیش‌فرض (۱۳ رقمی - اختیاری)</Label>
                    <Input
                      id="sstid-input"
                      dir="ltr"
                      maxLength={13}
                      value={defaultSstidInput}
                      onChange={(e) => setDefaultSstidInput(e.target.value)}
                      placeholder="مثال: 2330001234567"
                      className="font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="settlement-select">روش تسویه پیش‌فرض</Label>
                    <select
                      id="settlement-select"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={String(settlementMethodInput)}
                      onChange={(e) =>
                        setSettlementMethodInput(Number(e.target.value) as MoadianSettlementMethod)
                      }
                    >
                      <option value="1">{MOADIAN_SETTLEMENT_LABELS[1]}</option>
                      <option value="2">{MOADIAN_SETTLEMENT_LABELS[2]}</option>
                      <option value="3">{MOADIAN_SETTLEMENT_LABELS[3]}</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cert-pem-input">گواهی صادرشده توسط مرجع صدور (Certificate PEM)</Label>
                  <Textarea
                    id="cert-pem-input"
                    dir="ltr"
                    className="font-mono text-xs h-28"
                    placeholder="-----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----"
                    value={certPemInput}
                    onChange={(e) => setCertPemInput(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">گواهی تست صادرشده در سندباکس یا گواهی میانی مرکز ریشه صمت/جیکا.</p>
                </div>

                <div className="space-y-3 rounded-lg border bg-muted/30 p-3.5">
                  <div className="flex items-start gap-2.5">
                    <input
                      id="use-active-key-checkbox"
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-input"
                      checked={useActiveSigningKey}
                      onChange={(e) => setUseActiveSigningKey(e.target.checked)}
                    />
                    <div className="space-y-1 text-xs">
                      <Label htmlFor="use-active-key-checkbox" className="text-sm font-medium cursor-pointer">
                        استفاده خودکار از کلید فعال ذخیره‌شده سازمان (تولیدشده در گام ۲)
                      </Label>
                      <p className="text-muted-foreground">
                        {generatedKey
                          ? `کلید فعال با اثرانگشت ${generatedKey.keyFingerprint.slice(0, 16)}… در سرور موجود است و نیازی به ورود دستی کلید خصوصی نیست.`
                          : "اگر زوج‌کلید را در گام ۲ تولید کرده‌اید، با فعال‌سازی این گزینه کلید خصوصی مستقیماً روی سرور متصل می‌شود."}
                      </p>
                    </div>
                  </div>

                  {!useActiveSigningKey && (
                    <div className="space-y-1.5 pt-1">
                      <Label htmlFor="priv-key-input">کلید خصوصی متناظر (Private Key PEM)</Label>
                      <Textarea
                        id="priv-key-input"
                        dir="ltr"
                        className="font-mono text-xs h-28 bg-background"
                        placeholder="-----BEGIN RSA PRIVATE KEY----- ... -----END RSA PRIVATE KEY-----"
                        value={privKeyPemInput}
                        onChange={(e) => setPrivKeyPemInput(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">کلید خصوصی ورودی مستقیماً با AES-256-GCM رمزنگاری شده و هرگز در پاسخ‌های سرور نمایش داده نمی‌شود.</p>
                    </div>
                  )}
                </div>

                <div>
                  <Button
                    onClick={handleSaveCredential}
                    disabled={savingCred}
                    className="gap-2"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {savingCred ? "در حال ذخیره و اعتبارسنجی…" : "ذخیره اطلاعات مودیان در سیستم"}
                  </Button>
                </div>
              </CardContent>
              <CardFooter className="flex justify-between border-t pt-4">
                <Button variant="outline" onClick={() => setCurrentStep(2)}>
                  بازگشت به گام ۲
                </Button>
                <Button onClick={() => setCurrentStep(4)} className="gap-2">
                  رفتن به گام ۴: تست ارسال
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          )}

          {/* گام ۴: آزمون ارسال صورتحساب و استعلام برخط */}
          {currentStep === 4 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Send className="h-5 w-5 text-primary" />
                    <CardTitle>گام ۴: آزمون ارسال صورتحساب و استعلام برخط</CardTitle>
                  </div>
                  <Badge variant={isSandbox ? "outline" : "secondary"}>
                    {isSandbox ? "محیط آزمایشی (سندباکس)" : "محیط عملیاتی (Production)"}
                  </Badge>
                </div>
                <CardDescription>
                  {isSandbox
                    ? "ارسال یک صورتحساب تستی به محیط سندباکس سامانه مودیان جهت اطمینان از صحت الگوریتم محاسبه TaxID، امضای JWS و تأیید ساختار بسته در سرور مالیاتی."
                    : "ارسال رسمی صورتحساب به درگاه عملیاتی سامانه امور مالیاتی کشور با امضای دیجیتال معتبر."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5 text-sm">
                {/* هشدار محیط عملیاتی */}
                {!isSandbox && credential?.baseUrl && (
                  <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <AlertTitle>هشدار محیط عملیاتی (Production)</AlertTitle>
                    <AlertDescription className="text-xs space-y-2">
                      <p>
                        آدرس سامانه بر روی محیط رسمی سازمان امور مالیاتی (
                        <code dir="ltr" className="font-mono font-bold">{credential.baseUrl}</code>
                        ) تنظیم شده است. با ارسال، صورتحساب انتخابی به عنوان یک سند مالی رسمی و قطعی در کارپوشه مؤدی ثبت خواهد شد.
                      </p>
                      <label className="flex items-center gap-2 cursor-pointer font-medium pt-1">
                        <input
                          type="checkbox"
                          checked={confirmProductionSubmit}
                          onChange={(e) => setConfirmProductionSubmit(e.target.checked)}
                          className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                        />
                        <span>تأیید می‌کنم که این یک ارسال رسمی به محیط عملیاتی است.</span>
                      </label>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <div className="font-semibold text-foreground flex items-center justify-between">
                    <span>انتخاب فاکتور صادرشده جهت ارسال:</span>
                    <Badge variant="secondary">
                      {unsentLoadError
                        ? "وضعیت نامشخص"
                        : `${unsentInvoices.length} فاکتور صادرشده موجود`}
                    </Badge>
                  </div>

                  {unsentLoadError ? (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>خطا در دریافت سوابق ارسال مودیان</AlertTitle>
                      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                        <span>{unsentLoadError}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void loadUnsentInvoices()}
                        >
                          تلاش مجدد
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : unsentInvoices.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      هیچ صورتحساب صادرشده‌ای یافت نشد. لطفاً ابتدا از منوی صورتحساب‌ها یک فاکتور ثبت و صادر فرمایید.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[280px]"
                        value={selectedInvoiceId}
                        onChange={(e) => {
                          setSelectedInvoiceId(e.target.value);
                          setSubmissionResult(null);
                        }}
                      >
                        {unsentInvoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.taxInvoiceNumber} — {inv.buyerInfo?.name ?? "خریدار"} (
                            {formatMoneyRial(inv.finalPayable)})
                          </option>
                        ))}
                      </select>

                      <Button
                        onClick={handleTestSubmit}
                        disabled={
                          submittingInvoice ||
                          !selectedInvoiceId ||
                          !credential ||
                          (!isSandbox && !confirmProductionSubmit)
                        }
                        className="gap-2"
                      >
                        <Send className="h-4 w-4" />
                        {submittingInvoice
                          ? "در حال ارسال به صف…"
                          : isSandbox
                          ? "ارسال تست به مودیان (سندباکس)"
                          : "ارسال رسمی به سامانه مودیان"}
                      </Button>
                    </div>
                  )}

                  {!credential && (
                    <p className="text-xs text-destructive font-medium">
                      توجه: برای ارسال، ابتدا باید اطلاعات اتصال در مرحله ۳ ثبت شده باشد.
                    </p>
                  )}
                </div>

                {/* نمایش نتیجه ارسال */}
                {submissionResult && (
                  <div className="rounded-lg border p-4 space-y-3 bg-muted/10">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="font-semibold">نتیجه استعلام وضعیت ارسال:</span>
                      <Badge
                        variant={
                          submissionResult.status === "SUCCESS"
                            ? "default"
                            : submissionResult.status === "FAILED" || submissionResult.status === "ERROR"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {MOADIAN_STATUS_LABELS[submissionResult.status]}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground ml-1">شناسه مالیاتی (TaxID ۲۲ رقمی):</span>
                        <code dir="ltr" className="font-mono font-medium">{submissionResult.taxId}</code>
                      </div>
                      <div>
                        <span className="text-muted-foreground ml-1">کد پیگیری (UID):</span>
                        <code dir="ltr" className="font-mono">{submissionResult.uid}</code>
                      </div>
                      <div>
                        <span className="text-muted-foreground ml-1">شماره ارجاع مودیان:</span>
                        <span>{submissionResult.referenceNumber || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground ml-1">تعداد دفعات استعلام:</span>
                        <span>{submissionResult.pollCount} بار</span>
                      </div>
                    </div>

                    {submissionResult.errors && submissionResult.errors.length > 0 && (
                      <div className="rounded border border-destructive/30 bg-destructive/10 p-3 space-y-1">
                        <span className="font-semibold text-destructive text-xs">خطاهای بازگشتی سامانه:</span>
                        <ul className="list-inside list-disc text-xs text-destructive space-y-0.5">
                          {submissionResult.errors.map((err, idx) => (
                            <li key={idx}>
                              [{err.code}] {err.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {submissionResult.warnings && submissionResult.warnings.length > 0 && (
                      <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-1 text-xs">
                        <span className="font-semibold text-amber-800 dark:text-amber-300">هشدارهای سامانه:</span>
                        <ul className="list-inside list-disc text-amber-700 dark:text-amber-400 space-y-0.5">
                          {submissionResult.warnings.map((w, idx) => (
                            <li key={idx}>
                              [{w.code}] {w.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {pollingStatus && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        در حال استعلام دوره‌ای نتیجه نهایی از سرور مالیاتی…
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-between border-t pt-4">
                <Button variant="outline" onClick={() => setCurrentStep(3)}>
                  بازگشت به گام ۳
                </Button>
                <Button onClick={() => setCurrentStep(5)} className="gap-2">
                  رفتن به گام ۵: انتقال به محیط عملیاتی
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          )}

          {/* گام ۵: انتقال به محیط عملیاتی */}
          {currentStep === 5 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    <CardTitle>گام ۵: انتقال به محیط عملیاتی (Production)</CardTitle>
                  </div>
                  <Badge variant="default" className="bg-emerald-600 text-white">سامانه اصلی tp.tax.gov.ir</Badge>
                </div>
                <CardDescription>
                  راهنمای نهایی سوییچ از محیط تست به محیط تجاری سامانه مودیان و چک‌لیست الزامات قانونی.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm leading-relaxed">
                <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
                  <h4 className="font-semibold text-foreground flex items-center gap-1.5">
                    <ExternalLink className="h-4 w-4 text-primary" />
                    درگاه کارپوشه عملیاتی مؤدیان:
                  </h4>
                  <a
                    href="https://tp.tax.gov.ir"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-mono text-base font-medium flex items-center gap-1.5"
                  >
                    https://tp.tax.gov.ir
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>

                <div className="space-y-3">
                  <h4 className="font-semibold text-foreground">چک‌لیست انتقال به محیط واقعی:</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-md border p-3 space-y-1">
                      <div className="font-semibold text-foreground flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        ۱. دریافت گواهی امضای دیجیتال معتبر (CSR Sign)
                      </div>
                      <p className="text-muted-foreground">
                        فایل CSR تولیدشده در گام ۲ را به مرکز میانی معتبر (مرکز ریشه صمت یا دفاتر اسناد رسمی سامانه جیکا www.gica.ir) تحویل داده و فایل CRT نهایی را دریافت نمایید.
                      </p>
                    </div>

                    <div className="rounded-md border p-3 space-y-1">
                      <div className="font-semibold text-foreground flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        ۲. دریافت شناسه حافظه واقعی
                      </div>
                      <p className="text-muted-foreground">
                        در کارپوشه tp.tax.gov.ir با کلید عمومی رسمی ثبت‌نام نموده و شناسه حافظه ۶ حرفی نهایی را اخذ کنید.
                      </p>
                    </div>

                    <div className="rounded-md border p-3 space-y-1">
                      <div className="font-semibold text-foreground flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        ۳. بررسی شناسه‌های کالا و خدمات (SSTID)
                      </div>
                      <p className="text-muted-foreground">
                        اطمینان حاصل کنید کلیه کالاهای فاکتورهای فروش دارای کد معتبر ۱۳ رقمی سامانه استعلام شناسه باشند.
                      </p>
                    </div>

                    <div className="rounded-md border p-3 space-y-1">
                      <div className="font-semibold text-foreground flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        ۴. رعایت مهلت ارسال صورتحساب‌ها
                      </div>
                      <p className="text-muted-foreground">
                        صورتحساب‌های فروش را ظرف مهلت قانونی مقرر در آخرین بخشنامه‌های سازمان امور مالیاتی به سامانه ارسال نمایید.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 border-t pt-4">
                  <Link href="/app/tax" className={buttonVariants({ className: "gap-2" })}>
                    اتمام و بازگشت به داشبورد مالیات
                    <ArrowLeft className="h-4 w-4" />
                  </Link>
                  <Button variant="outline" onClick={() => setCurrentStep(3)}>
                    ویرایش تنظیمات اتصال در رکسایرا
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* بخش ویژه: پایش و هشدار مهلت ارسال صورتحساب‌ها */}
        <Card className="border-border shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-600" />
                <CardTitle>پایش و هشدار مهلت ارسال صورتحساب‌های فروش</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="deadline-days" className="text-xs">آستانه هشدار (روز تقویمی):</Label>
                <Input
                  id="deadline-days"
                  type="number"
                  min={1}
                  max={MOADIAN_MAX_DEADLINE_DAYS}
                  placeholder="تنظیم نشده"
                  className="w-24 h-8 text-center text-xs"
                  value={deadlineDays ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (!raw) {
                      setDeadlineDays(null);
                      return;
                    }
                    const parsed = Math.floor(Number(raw));
                    setDeadlineDays(
                      Number.isFinite(parsed) && parsed >= 1
                        ? Math.min(MOADIAN_MAX_DEADLINE_DAYS, parsed)
                        : null,
                    );
                  }}
                />
              </div>
            </div>
            <CardDescription>
              پایش صورتحساب‌های فروش صادرشده و ارسال‌نشده بر اساس آستانه تقویمی واردشده توسط کاربر؛ مقدار پیش‌فرضی اعمال نمی‌شود و قوانین کاری و میزان جرایم را از آخرین بخشنامه‌های سازمان امور مالیاتی پیگیری کنید.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {unsentLoadError ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>خطا در دریافت سوابق ارسال</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>{unsentLoadError}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void loadUnsentInvoices()}
                  >
                    تلاش مجدد
                  </Button>
                </AlertDescription>
              </Alert>
            ) : rankedUnsent.length === 0 ? (
              <p className="text-center py-6 text-sm text-muted-foreground">
                همهٔ صورتحساب‌های صادرشده در وضعیت ارسال‌شده قرار دارند یا صورتحساب معوقی یافت نشد.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">شماره صورتحساب</TableHead>
                      <TableHead className="text-right">تاریخ صدور</TableHead>
                      <TableHead className="text-right">خریدار</TableHead>
                      <TableHead className="text-right">مبلغ کل</TableHead>
                      <TableHead className="text-center">سپری‌شده / مهلت</TableHead>
                      <TableHead className="text-center">وضعیت مهلت</TableHead>
                      <TableHead className="text-center">اقدام</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankedUnsent.map(({ invoice, deadline }) => (
                      <TableRow key={invoice.id} className={deadline.isExpired ? "bg-destructive/5" : ""}>
                        <TableCell className="font-mono text-xs font-medium">
                          {invoice.invoiceNumber}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatJalaliDate(invoice.issueDate)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {invoice.buyerName || "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {formatMoneyRial(invoice.total)}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          {deadline.deadlineDays !== null
                            ? `${deadline.elapsedDays} روز از ${deadline.deadlineDays} روز`
                            : `${deadline.elapsedDays} روز سپری‌شده`}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={deadline.badgeVariant} className="text-xs">
                            {deadline.statusLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant={deadline.isExpired ? "destructive" : "outline"}
                            className="h-7 text-xs gap-1"
                            onClick={() => {
                              setSelectedInvoiceId(invoice.id);
                              setCurrentStep(4);
                            }}
                          >
                            <Send className="h-3 w-3" />
                            انتخاب برای ارسال
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
      </div>
    </EnterpriseRouteGuard>
  );
}
