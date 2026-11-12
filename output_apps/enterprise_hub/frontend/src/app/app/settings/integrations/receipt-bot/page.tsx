"use client";

import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Copy, ExternalLink, Lock, RefreshCw, Send, Trash2 } from "lucide-react";

import { useAccess } from "@/components/app/access-provider";
import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  generateReceiptBotCode,
  getReceiptBotStatus,
  unlinkReceiptBot,
  updateReceiptBotPreferences,
} from "@/lib/api/receipt-bot-client";
import type { GenerateLinkCodeResponse, ReceiptBotStatusResponse } from "@/types/receipt-bot";

export default function ReceiptBotSettingsPage() {
  const { can } = useAccess();
  const canManage = can("accounting", "post");
  const [status, setStatus] = useState<ReceiptBotStatusResponse | null>(null);
  const [linkCode, setLinkCode] = useState<GenerateLinkCodeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const data = await getReceiptBotStatus();
      setStatus(data);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getReceiptBotStatus();
        if (active) setStatus(data);
      } catch (err) {
        if (active) setError(loadErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleGenerateCode() {
    setBusy(true);
    setError(null);
    try {
      const data = await generateReceiptBotCode();
      setLinkCode(data);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink() {
    if (!confirm("آیا از قطع اتصال این پیام‌رسان از حساب خود اطمینان دارید؟")) return;
    setBusy(true);
    setError(null);
    try {
      await unlinkReceiptBot();
      setLinkCode(null);
      await loadStatus();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePreferenceChange(kind: "petty_cash" | "purchase") {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateReceiptBotPreferences({ defaultKind: kind });
      setStatus(updated);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function copyCode() {
    if (!linkCode?.code) return;
    navigator.clipboard.writeText(linkCode.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <EnterpriseRouteGuard>
      <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
        <PageHeader
          title="بات دریافت رسید و فاکتور (تلگرام)"
          description="ارسال مستقیم عکس رسیدها و فاکتورهای هزینه‌ای از ربات تلگرام به رکسایرا جهت ایجاد پیش‌نویس خودکار"
        />

        {!canManage && (
          <Alert>
            <Lock className="size-4" />
            <AlertTitle>دسترسی فقط‌خواندنی</AlertTitle>
            <AlertDescription>
              برای اتصال یا قطع ارتباط با ربات تلگرام و تغییر تنظیمات پیش‌فرض، دسترسی ثبت اسناد حسابداری لازم است.
            </AlertDescription>
          </Alert>
        )}

        {error && <ErrorNotice title="خطا در عملیات ربات" message={error} />}
        {loading && <LoadingLine show />}

        {status && (
          <div className="grid gap-6">
            {/* وضعیت اتصال */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="size-5 text-primary" />
                    <CardTitle className="text-lg">وضعیت اتصال به ربات</CardTitle>
                  </div>
                  {status.linked ? (
                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      متصل شده
                    </Badge>
                  ) : (
                    <Badge variant="outline">متصل نیست</Badge>
                  )}
                </div>
                <CardDescription>
                  اتصال حساب کاربری شما به ربات تلگرام رکسایرا
                </CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                {status.linked ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="size-4 text-emerald-600" />
                      <span>
                        حساب کاربری شما به شناسه تلگرام{" "}
                        <strong className="text-foreground">
                          {status.telegramUsername ? `@${status.telegramUsername}` : "متصل"}
                        </strong>{" "}
                        پیوند خورده است.
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      از این پس کافیست عکس رسیدها یا فاکتورهای خود را به ربات بفرستید. پیش‌نویس آن‌ها فوراً در بخش «ثبت خودکار فاکتور» ایجاد می‌شود.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-muted-foreground">
                      برای شروع دریافت خودکار رسیدها، با کلیک روی دکمهٔ زیر یک کد اتصال یکبار مصرف بسازید و آن را در ربات تلگرام ارسال کنید.
                    </p>

                    {linkCode ? (
                      <div className="flex flex-col gap-3 p-4 rounded-lg border bg-muted/40">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">کد اتصال یکبار مصرف شما:</span>
                          <span className="text-xs text-muted-foreground">اعتبار: ۱۰ دقیقه</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-2xl font-mono tracking-widest bg-background px-4 py-2 rounded border font-bold">
                            {linkCode.code}
                          </div>
                          <Button variant="outline" size="icon" onClick={copyCode} title="کپی کد">
                            <Copy className="size-4" />
                          </Button>
                          {copied && <span className="text-xs text-emerald-600 font-medium">کپی شد!</span>}
                        </div>

                        {linkCode.deepLink && (
                          <div className="pt-2">
                            <a
                              href={linkCode.deepLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                            >
                              <Send className="size-4" /> باز کردن ربات در تلگرام
                              <ExternalLink className="size-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    ) : canManage ? (
                      <div>
                        <Button onClick={handleGenerateCode} disabled={busy}>
                          <RefreshCw className={`size-4 mr-2 ${busy ? "animate-spin" : ""}`} />
                          ایجاد کد اتصال جدید
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </CardContent>

              {status.linked && canManage && (
                <CardFooter className="border-t pt-4 flex justify-between">
                  <Button variant="destructive" size="sm" onClick={handleUnlink} disabled={busy}>
                    <Trash2 className="size-4 mr-2" />
                    قطع اتصال ربات
                  </Button>
                </CardFooter>
              )}
            </Card>

            {/* تنظیمات پیش‌نویس‌های دریافتی */}
            {status.linked && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">نوع پیش‌فرض پیش‌نویس</CardTitle>
                  <CardDescription>
                    همهٔ رسیدهای ارسالی از تلگرام به‌عنوان پیش‌نویس «فاکتور خرید» در بخش ثبت خودکار ذخیره می‌شوند؛ در اینجا می‌توانید برچسب پیش‌فرض راهنمای دسته‌بندی را مشخص کنید:
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3">
                    <label
                      htmlFor="petty_cash"
                      className="flex items-center gap-3 cursor-pointer rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <input
                        type="radio"
                        id="petty_cash"
                        name="defaultKind"
                        value="petty_cash"
                        checked={status.defaultKind === "petty_cash"}
                        onChange={() => handlePreferenceChange("petty_cash")}
                        disabled={busy || !canManage}
                        className="size-4 text-primary accent-primary"
                      />
                      <div className="text-sm">
                        <strong className="font-semibold text-foreground">برچسب «تنخواه‌گردان» روی پیش‌نویس خرید</strong> — افزودن برچسب تنخواه‌گردان برای هزینه‌های جاری (به‌صورت پیش‌نویس خرید ذخیره می‌شود)
                      </div>
                    </label>
                    <label
                      htmlFor="purchase"
                      className="flex items-center gap-3 cursor-pointer rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <input
                        type="radio"
                        id="purchase"
                        name="defaultKind"
                        value="purchase"
                        checked={status.defaultKind === "purchase"}
                        onChange={() => handlePreferenceChange("purchase")}
                        disabled={busy || !canManage}
                        className="size-4 text-primary accent-primary"
                      />
                      <div className="text-sm">
                        <strong className="font-semibold text-foreground">فاکتور خرید (Purchase Invoice)</strong> — برای فاکتورهای رسمی و غیررسمی خرید کالا یا خدمات
                      </div>
                    </label>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* راهنمای نحوه کار */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">راهنمای استفاده</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground leading-relaxed">
                <p>۱. کد اتصال ۶ رقمی را ایجاد کرده و برای ربات پیام‌رسان بفرستید.</p>
                <p>۲. عکس فاکتور یا رسید کاغذی خود را به همراه توضیح اختیاری (کپشن) به ربات ارسال کنید.</p>
                <p>۳. هوش مصنوعی رکسایرا اقلام، مبالغ و فروشنده را استخراج کرده و پیش‌نویس سند را آماده می‌سازد.</p>
                <p>۴. شما در پنل رکسایرا پیش‌نویس را بازبینی کرده و با یک کلیک تأیید و ثبت حسابداری می‌فرمایید.</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </EnterpriseRouteGuard>
  );
}
