"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { Building2, Loader2, Trash2, UserPlus } from "lucide-react";

import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiClientError } from "@/lib/api/http-client";
import {
  addTenantMember,
  getMyTenant,
  listTenantMembers,
  removeTenantMember,
} from "@/lib/api/tenants-client";
import {
  TENANT_ROLE_LABELS,
  TenantRole,
  type TenantMe,
  type TenantMember,
} from "@/types/tenants";

const IRANIAN_MOBILE_REGEX = /^09\d{9}$/;

/**
 * صفحه سازمان و اعضا (`/team`).
 *
 * نام سازمان، فهرست اعضا و فرم افزودن/حذف عضو را از طریق اندپوینت‌های
 * `enterprise-hub/tenants` نمایش می‌دهد. عملیات مدیریت اعضا فقط برای مالک
 * سازمان فعال است (سرور نیز مستقلاً با `requireTenantOwner` آن را اعمال
 * می‌کند).
 */
export default function TeamPage() {
  const [tenant, setTenant] = useState<TenantMe | null>(null);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<string[] | null>(null);
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<TenantRole>(TenantRole.MEMBER);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  const isOwner = tenant?.tenantRole === TenantRole.OWNER;

  const load = useCallback((signal?: AbortSignal) => {
    startTransition(async () => {
      try {
        const me = await getMyTenant(signal);
        setTenant(me);
        if (me.tenantRole === TenantRole.OWNER) {
          const list = await listTenantMembers(signal);
          setMembers(list);
        } else {
          setMembers([]);
        }
        setErrorMessage(null);
      } catch (error) {
        if (error instanceof ApiClientError) {
          setErrorMessage(error.details.join(" | "));
        } else if (!(error instanceof DOMException)) {
          setErrorMessage(
            "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
          );
        }
      }
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  function handleRefresh() {
    setRefreshKey((key) => key + 1);
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormErrors(null);

    const normalized = phone.trim();
    if (!IRANIAN_MOBILE_REGEX.test(normalized)) {
      setFormErrors(["شماره همراه باید با فرمت 09xxxxxxxxx و ۱۱ رقم باشد."]);
      return;
    }

    setAdding(true);
    try {
      await addTenantMember({ phone: normalized, tenantRole: role });
      setPhone("");
      setRole(TenantRole.MEMBER);
      handleRefresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFormErrors(error.details);
      } else {
        setFormErrors(["افزودن عضو ناموفق بود. لطفاً دوباره تلاش کنید."]);
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(member: TenantMember) {
    setRemovingId(member.id);
    setErrorMessage(null);
    try {
      await removeTenantMember(member.id);
      handleRefresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorMessage(error.details.join(" | "));
      } else {
        setErrorMessage("حذف عضو ناموفق بود. لطفاً دوباره تلاش کنید.");
      }
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <EnterpriseRouteGuard>
      <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
          <div className="flex flex-col gap-1">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Building2 className="size-6 text-indigo-500" />
              سازمان و اعضا
            </h1>
            <p className="text-sm text-muted-foreground">
              مشاهده سازمان جاری، فهرست اعضا و مدیریت دسترسی‌ها — متصل به{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                /tenants
              </code>
            </p>
          </div>

          {errorMessage && (
            <Alert variant="destructive">
              <AlertTitle>خطا در دریافت اطلاعات سازمان</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-4 text-indigo-500" />
                {tenant?.name ?? "در حال بارگذاری..."}
              </CardTitle>
              <CardDescription>
                {tenant
                  ? `شناسه سازمان: ${tenant.slug} — نقش شما: ${
                      tenant.tenantRole
                        ? TENANT_ROLE_LABELS[tenant.tenantRole]
                        : "بدون نقش"
                    }`
                  : "اطلاعات سازمان در حال بارگذاری است."}
              </CardDescription>
            </CardHeader>
          </Card>

          {isOwner && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="size-4 text-indigo-500" />
                  افزودن عضو جدید
                </CardTitle>
                <CardDescription>
                  شماره همراه را وارد کنید؛ در صورت نبود حساب، کاربر ایجاد و به
                  سازمان شما متصل می‌شود.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={handleAdd}
                  className="flex flex-col gap-4"
                  noValidate
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="grid gap-2 sm:col-span-2">
                      <Label htmlFor="member-phone">شماره همراه</Label>
                      <Input
                        id="member-phone"
                        dir="ltr"
                        inputMode="numeric"
                        value={phone}
                        placeholder="09121234567"
                        maxLength={11}
                        onChange={(event) => setPhone(event.target.value)}
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label>نقش سازمانی</Label>
                      <Select<string>
                        value={role}
                        onValueChange={(value) =>
                          setRole((value as TenantRole) ?? TenantRole.MEMBER)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="انتخاب نقش" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={TenantRole.MEMBER}>
                            {TENANT_ROLE_LABELS[TenantRole.MEMBER]}
                          </SelectItem>
                          <SelectItem value={TenantRole.OWNER}>
                            {TENANT_ROLE_LABELS[TenantRole.OWNER]}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {formErrors && (
                    <Alert variant="destructive">
                      <AlertTitle>خطا در افزودن عضو</AlertTitle>
                      <AlertDescription>
                        <ul className="list-inside list-disc">
                          {formErrors.map((message) => (
                            <li key={message}>{message}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    disabled={adding}
                    className="self-start"
                  >
                    {adding ? (
                      <>
                        <Loader2 className="animate-spin" />
                        در حال افزودن...
                      </>
                    ) : (
                      <>
                        <UserPlus />
                        افزودن عضو
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>اعضای سازمان</span>
                {isPending && (
                  <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    در حال به‌روزرسانی...
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                {isOwner
                  ? "شماره همراه اعضا برای حفظ حریم خصوصی پوشانده شده است."
                  : "فهرست اعضا فقط برای مالک سازمان قابل مشاهده است."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {members.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {isOwner
                    ? "هنوز عضوی به سازمان اضافه نشده است."
                    : "مشاهده فهرست اعضا نیازمند دسترسی مالک سازمان است."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {members.map((member) => (
                    <li
                      key={member.id}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex flex-col">
                        <span className="font-mono text-sm" dir="ltr">
                          {member.phone}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {member.tenantRole
                            ? TENANT_ROLE_LABELS[member.tenantRole]
                            : "بدون نقش"}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={removingId === member.id}
                        onClick={() => void handleRemove(member)}
                      >
                        {removingId === member.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Trash2 />
                        )}
                        حذف
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </main>
        <RoxiraFooter />
      </div>
    </EnterpriseRouteGuard>
  );
}
