"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Bot,
  ClipboardList,
  EyeOff,
  FileUp,
  KeyRound,
  Puzzle,
  Settings,
  ShieldCheck,
  UsersRound,
  Workflow,
  ArrowLeft,
} from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMyTenant, updateMyTenantSettings } from "@/lib/api/tenants-client";
import { cn } from "@/lib/utils";

interface SettingTab {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: typeof Settings;
  badge?: string;
}

const SETTING_TABS: SettingTab[] = [
  {
    id: "members",
    label: "اعضا و نقش‌ها",
    description: "مدیریت کاربران سازمان، دعوت‌نامه‌ها، سطوح دسترسی و ساختار شعب و دپارتمان‌ها",
    href: "/app/settings/members",
    icon: UsersRound,
  },
  {
    id: "modules",
    label: "ماژول‌ها و اشتراک",
    description: "فعال‌سازی ماژول‌های حسابداری، حقوق، انبارداری، CRM و قابلیت‌های سازمان",
    href: "/app/settings/modules",
    icon: Puzzle,
  },
  {
    id: "posting-rules",
    label: "ثبت خودکار سند",
    description: "تنظیم الگوها و قوانین حسابداری خودکار برای خرید، فروش، چک و انبار",
    href: "/app/settings/posting-rules",
    icon: Workflow,
  },
  {
    id: "policies",
    label: "قواعد سازمان",
    description: "تنظیم سال مالی پیش‌فرض، روال‌های تایید چندمرحله‌ای و سیاست‌های کنترلی",
    href: "/app/settings/policies",
    icon: KeyRound,
  },
  {
    id: "import",
    label: "ورود اطلاعات و مهاجرت",
    description: "انتقال داده‌ها از سپیدار، هلو، فایل‌های اکسل، CSV و بازیابی پشتیبان",
    href: "/app/import",
    icon: FileUp,
    badge: "مهاجرت",
  },
  {
    id: "integrations",
    label: "اتصال‌ها و بات‌ها",
    description: "مدیریت بات تلگرام دریافت رسید، وب‌هوک‌ها و سامانه‌های جانبی",
    href: "/app/settings/integrations/receipt-bot",
    icon: Bot,
  },
  {
    id: "audit",
    label: "گزارش رخدادها",
    description: "مشاهده لاگ ورودها، تغییرات اسناد، حذف‌ها و رخدادهای امنیتی سازمان",
    href: "/app/settings/audit",
    icon: ClipboardList,
  },
  {
    id: "security",
    label: "امنیت حساب",
    description: "تایید دومرحله‌ای (TOTP)، نشست‌های فعال و رمز عبور",
    href: "/app/settings/security",
    icon: ShieldCheck,
  },
];

function SettingsHubContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") ?? "members";
  const [activeTabId, setActiveTabId] = useState<string>(initialTab);
  const [noEmployeeTelemetry, setNoEmployeeTelemetry] = useState<boolean>(false);
  const [telemetryLoading, setTelemetryLoading] = useState<boolean>(true);
  const [telemetrySaving, setTelemetrySaving] = useState<boolean>(false);
  const [telemetryMessage, setTelemetryMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getMyTenant(controller.signal)
      .then((tenant) => {
        setNoEmployeeTelemetry(Boolean(tenant.noEmployeeTelemetry));
      })
      .catch(() => {
        // Non-blocking: keep default false if tenant fetch fails
      })
      .finally(() => {
        setTelemetryLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function handleToggleNoEmployeeTelemetry() {
    const next = !noEmployeeTelemetry;
    setTelemetrySaving(true);
    setTelemetryMessage(null);
    try {
      const updated = await updateMyTenantSettings({ noEmployeeTelemetry: next });
      setNoEmployeeTelemetry(Boolean(updated.noEmployeeTelemetry));
      setTelemetryMessage(
        updated.noEmployeeTelemetry
          ? "حالت بدون رصد کارکنان فعال شد."
          : "حالت بدون رصد کارکنان غیرفعال شد.",
      );
    } catch {
      setTelemetryMessage("ذخیره تنظیمات با خطا مواجه شد.");
    } finally {
      setTelemetrySaving(false);
    }
  }

  const activeTab = SETTING_TABS.find((t) => t.id === activeTabId) ?? SETTING_TABS[0];
  const ActiveIcon = activeTab.icon;

  return (
    <>
      <PageHeader
        title="تنظیمات سازمان"
        description="مدیریت متمرکز اعضا، ماژول‌ها، قوانین حسابداری، ورود داده‌ها و امنیت"
        icon={<Settings className="size-6 text-indigo-400" aria-hidden="true" />}
      />

      {/* Tabs navigation */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {SETTING_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span>{tab.label}</span>
              {tab.badge && (
                <Badge variant="outline" className="text-[10px] py-0 px-1 border-indigo-400/30 text-indigo-300">
                  {tab.badge}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Active tab summary card & deep dive */}
      <Card className="border border-border bg-card">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
              <ActiveIcon className="size-5" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base">{activeTab.label}</CardTitle>
              <CardDescription className="text-xs">{activeTab.description}</CardDescription>
            </div>
          </div>
          <Link href={activeTab.href}>
            <Button size="sm" className="gap-2">
              <span>ورود به بخش {activeTab.label}</span>
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            برای پیکربندی و مشاهده جزئیات کامل، دکمه «ورود به بخش {activeTab.label}» را بزنید.
          </div>
        </CardContent>
      </Card>

      {/* Works-council / no-employee-telemetry mode (T265) */}
      <Card className="border border-border bg-card">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
              <EyeOff className="size-5" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base">
                حالت بدون رصد کارکنان (Works-Council / BetrVG §87(1)6)
              </CardTitle>
              <CardDescription className="text-xs">
                با فعال‌سازی این گزینه، داشبوردهای فعالیت فردی و آمار مصرف هوش مصنوعی کاربران در سطح سازمان مخفی و مسدود می‌شوند.
              </CardDescription>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={noEmployeeTelemetry ? "default" : "outline"}
            disabled={telemetryLoading || telemetrySaving}
            onClick={handleToggleNoEmployeeTelemetry}
            aria-pressed={noEmployeeTelemetry}
          >
            {telemetrySaving
              ? "در حال ذخیره…"
              : noEmployeeTelemetry
                ? "فعال (کلیک برای غیرفعال‌سازی)"
                : "غیرفعال (کلیک برای فعال‌سازی)"}
          </Button>
        </CardHeader>
        {telemetryMessage && (
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">{telemetryMessage}</p>
          </CardContent>
        )}
      </Card>

      {/* Grid of all setting cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SETTING_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <Link key={tab.id} href={tab.href} className="group block">
              <Card className="h-full border border-border transition-all hover:border-indigo-500/50 hover:bg-muted/40">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300 group-hover:bg-indigo-500/20">
                      <Icon className="size-4" aria-hidden="true" />
                    </div>
                    {tab.badge && (
                      <Badge variant="outline" className="text-[10px] border-indigo-400/30 text-indigo-300">
                        {tab.badge}
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="mt-2 text-sm font-semibold">{tab.label}</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-1 text-xs text-muted-foreground leading-relaxed">
                  {tab.description}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}

export default function SettingsHubPage() {
  return (
    <EnterpriseRouteGuard>
      <Suspense fallback={<div className="p-8 text-center text-xs text-muted-foreground">در حال بارگذاری تنظیمات…</div>}>
        <SettingsHubContent />
      </Suspense>
    </EnterpriseRouteGuard>
  );
}
