"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, RefreshCw, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/app/app-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getWooCommerceConfig,
  getWooCommerceLogs,
  updateWooCommerceConfig,
} from "@/lib/api/woocommerce-client";
import type { WooCommerceConfig, WooCommerceSyncLog } from "@/types/woocommerce";

export default function WooCommerceSettingsPage() {
  const [config, setConfig] = useState<WooCommerceConfig | null>(null);
  const [logs, setLogs] = useState<WooCommerceSyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Form State
  const [storeUrl, setStoreUrl] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [autoSyncOrders, setAutoSyncOrders] = useState(true);
  const [autoSyncStock, setAutoSyncStock] = useState(true);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await getWooCommerceConfig().catch(() => null);
      if (cfg) {
        setConfig(cfg);
        setStoreUrl(cfg.storeUrl || "");
        setWebhookSecret("");
        setAutoSyncOrders(cfg.autoSyncOrders);
        setAutoSyncStock(cfg.autoSyncStock);
      }
      const logRes = await getWooCommerceLogs({ limit: 20 }).catch(() => ({ items: [], total: 0 }));
      setLogs(logRes.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در بارگذاری اطلاعات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cfg = await getWooCommerceConfig().catch(() => null);
        if (active && cfg) {
          setConfig(cfg);
          setStoreUrl(cfg.storeUrl || "");
          setWebhookSecret("");
          setAutoSyncOrders(cfg.autoSyncOrders);
          setAutoSyncStock(cfg.autoSyncStock);
        }
        const logRes = await getWooCommerceLogs({ limit: 20 }).catch(() => ({ items: [], total: 0 }));
        if (active) {
          setLogs(logRes.items);
        }
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : "خطا در بارگذاری اطلاعات");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateWooCommerceConfig({
        storeUrl,
        consumerKey: consumerKey || undefined,
        consumerSecret: consumerSecret || undefined,
        webhookSecret: webhookSecret || undefined,
        autoSyncOrders,
        autoSyncStock,
      });
      setConfig(updated);
      setRevealedWebhookSecret(updated.generatedWebhookSecret ?? null);
      setSuccess(
        updated.generatedWebhookSecret
          ? "تنظیمات ذخیره شد. کلید وب‌هوک زیر را همین الان کپی کنید؛ پس از ترک صفحه دیگر قابل مشاهده نخواهد بود."
          : "تنظیمات اتصال با موفقیت ذخیره شد.",
      );
      setConsumerKey("");
      setConsumerSecret("");
      setWebhookSecret("");
      loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در ذخیره تنظیمات");
    } finally {
      setSaving(false);
    }
  };

  const copyWebhookUrl = () => {
    const fullUrl = `${window.location.origin}${config?.webhookUrl || "/api/backend/enterprise-hub/integrations/woocommerce/webhook"}`;
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyGeneratedSecret = () => {
    if (!revealedWebhookSecret) return;
    navigator.clipboard.writeText(revealedWebhookSecret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="اتصال به فروشگاه ووکامرس (WooCommerce)"
        description="همگام‌سازی خودکار سفارش‌های فروشگاه اینترنتی با صدور پیش‌نویس فاکتور فروش و مدیریت موجودی کالا"
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <AlertDescription className="text-emerald-700 dark:text-emerald-400">{success}</AlertDescription>
        </Alert>
      )}

      {revealedWebhookSecret && (
        <Alert className="border-amber-500/50 bg-amber-50/60 dark:bg-amber-950/20">
          <AlertDescription className="space-y-2">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
              کلید مخفی وب‌هوک تولیدشده (نمایش یک‌باره برای ثبت در ووکامرس):
            </p>
            <div className="flex items-center gap-2 rounded border bg-background p-2 text-xs">
              <code className="font-mono flex-1 select-all break-all" dir="ltr">
                {revealedWebhookSecret}
              </code>
              <Button type="button" variant="ghost" size="sm" onClick={copyGeneratedSecret} className="h-8 px-2">
                {copiedSecret ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Settings Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <ShoppingCart className="h-5 w-5 text-primary" />
              پیکربندی کلیدهای API ووکامرس
            </CardTitle>
            <CardDescription>
              کلیدهای اختصاصی REST API را از پیشخوان وردپرس (تنظیمات &gt; پیشرفته &gt; REST API) دریافت کنید.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <form onSubmit={handleSave} className="space-y-4">
                {config && (
                  <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">وضعیت اتصال:</span>
                      <Badge variant={config.hasConsumerSecret ? "default" : "secondary"}>
                        {config.hasConsumerSecret ? "کلیدها تنظیم شده است" : "تنظیم‌نشده"}
                      </Badge>
                    </div>
                    {config.maskedConsumerKey && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">کلید فعال:</span>
                        <span className="font-mono">{config.maskedConsumerKey}</span>
                      </div>
                    )}
                    {config.webhookSecret && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">کلید وب‌هوک فعال:</span>
                        <span className="font-mono">{config.webhookSecret}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="storeUrl">آدرس فروشگاه (Store URL)</Label>
                  <Input
                    id="storeUrl"
                    dir="ltr"
                    placeholder="https://example.com"
                    value={storeUrl}
                    onChange={(e) => setStoreUrl(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="consumerKey">Consumer Key (ck_...)</Label>
                  <Input
                    id="consumerKey"
                    dir="ltr"
                    type="password"
                    placeholder={config?.maskedConsumerKey || "ck_..."}
                    value={consumerKey}
                    onChange={(e) => setConsumerKey(e.target.value)}
                    required={!config?.hasConsumerSecret}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="consumerSecret">Consumer Secret (cs_...)</Label>
                  <Input
                    id="consumerSecret"
                    dir="ltr"
                    type="password"
                    placeholder={config?.hasConsumerSecret ? "••••••••••••••••••••••••••••••••" : "cs_..."}
                    value={consumerSecret}
                    onChange={(e) => setConsumerSecret(e.target.value)}
                    required={!config?.hasConsumerSecret}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="webhookSecret">Webhook Secret (برای اعتبارسنجی امضای HMAC)</Label>
                  <Input
                    id="webhookSecret"
                    dir="ltr"
                    type="password"
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    placeholder={
                      config?.webhookSecret
                        ? `${config.webhookSecret} (برای تغییر مقدار جدید وارد کنید)`
                        : "تولید خودکار در صورت خالی بودن"
                    }
                  />
                </div>

                <div className="space-y-2 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={autoSyncOrders}
                      onChange={(e) => setAutoSyncOrders(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>ایجاد خودکار پیش‌نویس فاکتور فروش به محض ثبت سفارش در ووکامرس</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={autoSyncStock}
                      onChange={(e) => setAutoSyncStock(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>همگام‌سازی موجودی و قیمت کالاها با تغییرات انبار روکسیرا</span>
                  </label>
                </div>

                <Button type="submit" disabled={saving} className="w-full">
                  {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
                  ذخیره تنظیمات
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Webhook Instructions Card */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold">تنظیم وب‌هوک در وردپرس</CardTitle>
              <CardDescription>
                جهت ارسال فوری سفارش‌ها، یک وب‌هوک در ووکامرس ایجاد کنید:
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-relaxed">
              <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                <li>وارد پیشخوان وردپرس &gt; ووکامرس &gt; پیکربندی &gt; پیشرفته &gt; وب‌هوک‌ها شوید.</li>
                <li>روی «افزودن وب‌هوک» کلیک کنید.</li>
                <li>موضوع (Topic) را روی <strong>«سفارش ایجاد شد» (Order created)</strong> قرار دهید.</li>
                <li>آدرس تحویل (Delivery URL) زیر را وارد کنید:</li>
              </ol>

              {config?.webhookUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 text-xs">
                    <span className="font-mono text-left flex-1 select-all break-all" dir="ltr">
                      {typeof window !== "undefined" ? `${window.location.origin}${config.webhookUrl}` : config.webhookUrl}
                    </span>
                    <Button variant="ghost" size="sm" onClick={copyWebhookUrl} className="h-8 px-2">
                      {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    کلید مخفی (Secret) وب‌هوک را برابر با <strong>Webhook Secret</strong> فرم بالا قرار دهید.
                  </p>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">
                  پس از ذخیره اولین تنظیمات، آدرس وب‌هوک اختصاصی سازمان نمایش داده خواهد شد.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sync Logs Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold">لاگ‌های اخیر همگام‌سازی</CardTitle>
                <CardDescription>آخرین رویدادهای دریافتی و ارسالی ووکامرس</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={loadData}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  هنوز هیچ رویدادی ثبت نشده است.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-right">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="pb-2 font-medium">نوع</th>
                        <th className="pb-2 font-medium">شناسه خارجی</th>
                        <th className="pb-2 font-medium">وضعیت</th>
                        <th className="pb-2 font-medium">زمان</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {logs.map((log) => (
                        <tr key={log.id} className="hover:bg-muted/30">
                          <td className="py-2">
                            {log.direction === "inbound_order"
                              ? "ورود سفارش"
                              : log.direction === "outbound_stock"
                              ? "بروزرسانی انبار"
                              : "بروزرسانی قیمت"}
                          </td>
                          <td className="py-2 font-mono">#{log.externalId}</td>
                          <td className="py-2">
                            <Badge
                              variant={
                                log.status === "success"
                                  ? "default"
                                  : log.status === "skipped"
                                  ? "secondary"
                                  : "destructive"
                              }
                            >
                              {log.status === "success"
                                ? "موفق"
                                : log.status === "skipped"
                                ? "ردشده (تکراری)"
                                : "خطا"}
                            </Badge>
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {new Date(log.createdAt).toLocaleTimeString("fa-IR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
