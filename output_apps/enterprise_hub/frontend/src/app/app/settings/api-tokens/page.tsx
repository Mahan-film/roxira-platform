"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Key,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { useAccess } from "@/components/app/access-provider";
import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "@/lib/api/api-tokens-client";
import { formatNumber } from "@/lib/fa-format";
import {
  API_SCOPES,
  SCOPE_LABELS_FA,
  type ApiScope,
  type ApiTokenView,
  type CreatedApiTokenView,
} from "@/types/api-tokens";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fa-IR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ApiTokensPage() {
  const { can } = useAccess();
  const canManage = can("security", "admin");

  const [tokens, setTokens] = useState<ApiTokenView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // فرم ایجاد
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ApiScope[]>(["invoices:read", "items:read"]);
  const [rateLimit, setRateLimit] = useState(60);
  const [expiryOption, setExpiryOption] = useState<"never" | "30" | "90" | "365">("never");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // نمایش یک‌بارهٔ توکن تازه ایجاد شده
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<CreatedApiTokenView | null>(null);
  const [copied, setCopied] = useState(false);

  // تأیید ابطال
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function loadTokens() {
    setLoading(true);
    setError(null);
    try {
      const data = await listApiTokens();
      setTokens(data);
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
        const data = await listApiTokens();
        if (active) setTokens(data);
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

  function toggleScope(scope: ApiScope) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function handleCreateToken(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setCreateError("لطفاً نام کلید را مشخص کنید.");
      return;
    }
    if (selectedScopes.length === 0) {
      setCreateError("حداقل یک دسترسی باید انتخاب شود.");
      return;
    }

    setCreating(true);
    setCreateError(null);

    let expiresAt: string | undefined = undefined;
    if (expiryOption !== "never") {
      const days = parseInt(expiryOption, 10);
      const d = new Date();
      d.setDate(d.getDate() + days);
      expiresAt = d.toISOString();
    }

    try {
      const created = await createApiToken({
        name: name.trim(),
        scopes: selectedScopes,
        rateLimitPerMinute: rateLimit,
        expiresAt,
      });
      // ذخیره در وضعیت نمایش یک‌باره و به‌روزرسانی فهرست
      setNewlyCreatedToken(created);
      setShowCreateForm(false);
      setName("");
      setSelectedScopes(["invoices:read", "items:read"]);
      setRateLimit(60);
      setExpiryOption("never");
      await loadTokens();
    } catch (err) {
      setCreateError(loadErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevokeToken(id: number) {
    setRevoking(true);
    try {
      await revokeApiToken(id);
      setRevokingId(null);
      await loadTokens();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setRevoking(false);
    }
  }

  async function handleCopyToken() {
    if (!newlyCreatedToken?.token) return;
    try {
      await navigator.clipboard.writeText(newlyCreatedToken.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback
    }
  }

  function handleDismissRevealedToken() {
    // پاک‌سازی فوری کلید از حافظه به نحوی که هرگز دوباره نمایش داده نشود
    setNewlyCreatedToken(null);
    setCopied(false);
  }

  useEffect(() => {
    if (!newlyCreatedToken) return;
    const clear = () => handleDismissRevealedToken();
    const onVisibility = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("beforeunload", clear);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setTimeout(clear, 60_000);
    return () => {
      window.removeEventListener("beforeunload", clear);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(timer);
    };
  }, [newlyCreatedToken]);

  return (
    <EnterpriseRouteGuard>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="کلیدهای دسترسی وب‌سرویس"
          description="مدیریت کلیدهای اتصال برنامه‌نویسی و وب‌سرویس سازمان، تعیین سطوح دسترسی و ابطال فوری کلیدها"
          icon={<Key className="size-6 text-primary" />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/app/settings"
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <ArrowRight className="size-3.5" />
                تنظیمات سازمان
              </Link>
              {canManage && !showCreateForm && !newlyCreatedToken && (
                <Button
                  size="sm"
                  onClick={() => setShowCreateForm(true)}
                  className="gap-1.5 text-xs"
                >
                  <Plus className="size-4" />
                  ایجاد کلید جدید
                </Button>
              )}
            </div>
          }
        />

        {error && <ErrorNotice error={error} />}

        {/* جعبه هشدار امنیتی نمایش یک‌باره کلید تازه ساخته‌شده */}
        {newlyCreatedToken && (
          <Card className="border-warning bg-warning/5">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 text-warning">
                <AlertTriangle className="size-5" />
                <CardTitle className="text-base font-semibold">
                  کلید دسترسی جدید با موفقیت ایجاد شد
                </CardTitle>
              </div>
              <CardDescription className="text-xs text-foreground/80">
                این کلید فقط همین یک‌بار نمایش داده می‌شود. لطفاً آن را کپی کرده و در محل امنی نگهداری کنید. پس از بستن این پنجره امکان مشاهده مجدد این کلید وجود ندارد.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <code
                  className="flex h-10 flex-1 items-center rounded-md border border-input bg-background px-3 font-mono text-sm text-start direction-ltr"
                  aria-label="کلید ایجاد شده"
                >
                  {`••••••${newlyCreatedToken.token.slice(-4)}`}
                </code>
                <Button
                  type="button"
                  onClick={handleCopyToken}
                  variant={copied ? "default" : "outline"}
                  className="gap-1.5 whitespace-nowrap"
                >
                  {copied ? (
                    <>
                      <Check className="size-4 text-emerald-500" />
                      کپی شد
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" />
                      کپی کلید
                    </>
                  )}
                </Button>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleDismissRevealedToken}
                >
                  کلید را ذخیره کردم و پنجره بسته شود
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* فرم ایجاد کلید جدید */}
        {showCreateForm && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">ساخت کلید دسترسی جدید</CardTitle>
              <CardDescription className="text-xs">
                نام و سطوح دسترسی مورد نیاز را تعیین کنید.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateToken} className="flex flex-col gap-5">
                {createError && <ErrorNotice error={createError} />}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="token-name" className="text-xs">
                      نام کلید (برای شناسایی در فهرست) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="token-name"
                      placeholder="مثلاً: اتصال فروشگاه آنلاین یا نرم‌افزار انبار"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={120}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="rate-limit" className="text-xs">
                        سقف درخواست (در دقیقه)
                      </Label>
                      <Input
                        id="rate-limit"
                        type="number"
                        min={1}
                        max={6000}
                        value={rateLimit}
                        onChange={(e) => setRateLimit(Math.max(1, parseInt(e.target.value, 10) || 60))}
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="expiry" className="text-xs">
                        مدت اعتبار
                      </Label>
                      <select
                        id="expiry"
                        className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                        value={expiryOption}
                        onChange={(e) => setExpiryOption(e.target.value as "never" | "30" | "90" | "365")}
                      >
                        <option value="never">بدون انقضا (دائمی)</option>
                        <option value="30">۳۰ روز</option>
                        <option value="90">۹۰ روز</option>
                        <option value="365">۱ سال</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-xs font-semibold">
                    دسترسی‌های مجاز کلید <span className="text-destructive">*</span>
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {API_SCOPES.map((scope) => {
                      const info = SCOPE_LABELS_FA[scope];
                      const isChecked = selectedScopes.includes(scope);
                      return (
                        <label
                          key={scope}
                          className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                            isChecked
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-muted/50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleScope(scope)}
                            className="mt-0.5 rounded border-input"
                          />
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-foreground">{info.label}</span>
                            <span className="text-muted-foreground text-[11px]">{info.description}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowCreateForm(false);
                      setCreateError(null);
                    }}
                    disabled={creating}
                  >
                    انصراف
                  </Button>
                  <Button type="submit" size="sm" disabled={creating} className="gap-1.5">
                    {creating && <RefreshCw className="size-3.5 animate-spin" />}
                    صدور کلید دسترسی
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* دیالوگ تأیید ابطال */}
        {revokingId !== null && (
          <Alert variant="destructive" className="border-destructive/50">
            <ShieldAlert className="size-4" />
            <AlertTitle className="text-sm font-semibold">تأیید ابطال کلید دسترسی</AlertTitle>
            <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-2">
              <span className="text-xs">
                با ابطال این کلید، تمام درخواست‌های برنامه‌های متصل با این توکن فوراً مسدود خواهند شد. این اقدام غیرقابل بازگشت است.
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRevokingId(null)}
                  disabled={revoking}
                >
                  انصراف
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRevokeToken(revokingId)}
                  disabled={revoking}
                  className="gap-1.5"
                >
                  {revoking && <RefreshCw className="size-3.5 animate-spin" />}
                  تأیید و ابطال قطعی
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* فهرست کلیدها */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base">کلیدهای دسترسی تعریف‌شده</CardTitle>
              <CardDescription className="text-xs">
                فهرست تمام کلیدهای فعال و ابطال‌شده سازمان
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadTokens}
              disabled={loading}
              className="gap-1 text-xs"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              به‌روزرسانی
            </Button>
          </CardHeader>
          <CardContent>
            {loading && <LoadingLine show />}

            {!loading && tokens.length === 0 && (
              <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground gap-2">
                <Shield className="size-10 stroke-1 text-muted-foreground/60" />
                <p className="text-sm font-medium">هیچ کلید دسترسی تاکنون ساخته نشده است.</p>
                <p className="text-xs">
                  برای اتصال سامانه‌های بیرونی از دکمه «ایجاد کلید جدید» استفاده کنید.
                </p>
              </div>
            )}

            {!loading && tokens.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>نام و پیشوند</TableHead>
                      <TableHead>دسترسی‌ها</TableHead>
                      <TableHead>سقف درخواست</TableHead>
                      <TableHead>آخرین استفاده</TableHead>
                      <TableHead>تاریخ انقضا</TableHead>
                      <TableHead>وضعیت</TableHead>
                      <TableHead className="text-end">عملیات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tokens.map((token) => {
                      const isRevoked = Boolean(token.revokedAt);
                      const isExpired =
                        token.expiresAt && new Date(token.expiresAt).getTime() < Date.now();
                      const isActive = !isRevoked && !isExpired;

                      return (
                        <TableRow key={token.id}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col gap-1">
                              <span>{token.name}</span>
                              <code className="text-[11px] text-muted-foreground font-mono direction-ltr text-start">
                                {token.tokenPrefix}...
                              </code>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1 max-w-xs">
                              {token.scopes.map((scope) => (
                                <Badge
                                  key={scope}
                                  variant="secondary"
                                  className="text-[10px] py-0 px-1.5"
                                >
                                  {SCOPE_LABELS_FA[scope as ApiScope]?.label ?? scope}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {formatNumber(token.rateLimitPerMinute)} در دقیقه
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {token.lastUsedAt ? formatDate(token.lastUsedAt) : "استفاده نشده"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {token.expiresAt ? formatDate(token.expiresAt) : "دائمی"}
                          </TableCell>
                          <TableCell>
                            {isRevoked ? (
                              <Badge variant="destructive" className="text-[10px]">
                                ابطال‌شده
                              </Badge>
                            ) : isExpired ? (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                منقضی‌شده
                              </Badge>
                            ) : (
                              <Badge variant="default" className="text-[10px]">
                                فعال
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-end">
                            {isActive && canManage && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRevokingId(token.id)}
                                className="text-destructive hover:bg-destructive/10 text-xs gap-1"
                              >
                                <Trash2 className="size-3.5" />
                                ابطال
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
