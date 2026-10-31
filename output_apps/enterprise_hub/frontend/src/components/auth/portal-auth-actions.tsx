"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, LogIn, UserPlus } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { LOGIN_COPY, SIGNUP_COPY } from "@/components/auth/portal-auth-copy";

const OUTLINE =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-indigo-400/40 hover:text-white";
const PRIMARY =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5";

/** Login and signup buttons of the roxira.ir headers; a signed-in user goes straight to the software. */
export function PortalAuthActions() {
  const { isAuthenticated, isLoading, openLogin } = useAuth();
  const router = useRouter();

  if (!isLoading && isAuthenticated) {
    return (
      <Link href="/app" className={PRIMARY}>
        <LayoutGrid className="size-3.5" />
        ورود به نرم‌افزار
      </Link>
    );
  }

  const open = (copy: typeof LOGIN_COPY) =>
    openLogin({ ...copy, serviceDomain: "ROXIRA", onSuccess: () => router.push("/app") });

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => open(LOGIN_COPY)} className={OUTLINE}>
        <LogIn className="size-3.5" />
        ورود
      </button>
      <button type="button" onClick={() => open(SIGNUP_COPY)} className={PRIMARY}>
        <UserPlus className="size-3.5" />
        ثبت‌نام
      </button>
    </div>
  );
}
