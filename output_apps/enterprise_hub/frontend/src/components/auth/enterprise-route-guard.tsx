"use client";

import type { ReactNode } from "react";
import { Lock, ShieldAlert } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { inferServiceDomain } from "@/lib/api/auth-client";

interface EnterpriseRouteGuardProps {
  children: ReactNode;
  /** صرفاً مدیر سازمان (نقش ADMIN) اجازهٔ مشاهده دارد. */
  requireAdmin?: boolean;
}

/**
 * گارد مسیر سمت کلاینت برای ماژول‌های سازمانی (لایهٔ UX، دفاع در عمق).
 *
 * فقط تجربهٔ کاربری را کنترل می‌کند؛ اعتبارسنجی نهایی و واقعی همیشه باید
 * در سرور (middleware و API) اعمال شود. در حالت بارگذاری متن فارسی، در
 * حالت عدم احراز هویت پیام همراه دکمهٔ ورود و در نبود نقش مدیر پیام محدودیت
 * نمایش داده می‌شود.
 */
/**
 * Organisation role from the JWT claims (UX only; the backend enforces access with
 * requireTenantAdmin). Every enterprise module is tenant-isolated now, so a tenant OWNER
 * may open the admin pages of their own organisation.
 */
function tenantRoleOf(token: string | null): string | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { tenantRole?: unknown };
    return typeof claims.tenantRole === "string" ? claims.tenantRole : null;
  } catch {
    return null;
  }
}

export function EnterpriseRouteGuard({
  children,
  requireAdmin = false,
}: EnterpriseRouteGuardProps) {
  const { isAuthenticated, isLoading, user, accessToken, openLogin } = useAuth();

  if (isLoading) {
    return (
      <div className="dark flex min-h-full flex-1 items-center justify-center bg-background px-4 py-16 text-foreground">
        <p className="text-sm text-muted-foreground" role="status">
          در حال بررسی دسترسی…
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="dark flex min-h-full flex-1 flex-col items-center justify-center gap-3 bg-background px-4 py-16 text-center text-foreground">
        <Lock className="size-8 text-indigo-500" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          برای دسترسی به این بخش ابتدا وارد شوید.
        </p>
        <button
          type="button"
          onClick={() =>
            openLogin({
              serviceDomain: inferServiceDomain(),
              title: "ورود به پورتال سازمانی روکسیرا",
              description:
                "برای دسترسی به ماژول‌های سازمانی، شماره همراه خود را وارد کنید.",
            })
          }
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5"
        >
          ورود به سامانه
        </button>
      </div>
    );
  }

  if (requireAdmin && user?.role !== "ADMIN" && tenantRoleOf(accessToken) !== "OWNER") {
    return (
      <div className="dark flex min-h-full flex-1 flex-col items-center justify-center gap-3 bg-background px-4 py-16 text-center text-foreground">
        <ShieldAlert className="size-8 text-rose-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-rose-300">
          دسترسی به این بخش فقط برای مدیر سامانه یا مالک سازمان است.
        </p>
        <p className="max-w-md text-xs leading-6 text-muted-foreground">
          داده‌های هر سازمان جداست و این بخش برای مالک سازمان و مدیر سامانه باز است. اگر مالک یا مدیر هستید، یک بار از حساب خارج و دوباره وارد شوید تا
          دسترسی جدید اعمال شود. برای درخواست دسترسی با پشتیبانی تماس بگیرید.
        </p>
        <a href="/team" className="text-xs font-bold text-indigo-400 hover:underline">
          مدیریت سازمان و اعضا
        </a>
      </div>
    );
  }

  return <>{children}</>;
}

export default EnterpriseRouteGuard;
