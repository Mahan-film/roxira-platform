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
export function EnterpriseRouteGuard({
  children,
  requireAdmin = false,
}: EnterpriseRouteGuardProps) {
  const { isAuthenticated, isLoading, user, openLogin } = useAuth();

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

  if (requireAdmin && user?.role !== "ADMIN") {
    return (
      <div className="dark flex min-h-full flex-1 flex-col items-center justify-center gap-3 bg-background px-4 py-16 text-center text-foreground">
        <ShieldAlert className="size-8 text-rose-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-rose-300">
          دسترسی به این بخش فقط برای مدیر سازمان است.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

export default EnterpriseRouteGuard;
