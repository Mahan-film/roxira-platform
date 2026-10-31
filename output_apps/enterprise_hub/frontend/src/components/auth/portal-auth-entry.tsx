"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/auth-provider";
import { LOGIN_COPY, SIGNUP_COPY } from "@/components/auth/portal-auth-copy";
import { SiteHeader } from "@/components/layout/site-header";

/** Linkable /login and /signup: both open the portal login dialog, then land in the software. */
export function PortalAuthEntry({ mode }: { mode: "login" | "signup" }) {
  const { isAuthenticated, isLoading, openLogin } = useAuth();
  const router = useRouter();
  const copy = mode === "login" ? LOGIN_COPY : SIGNUP_COPY;

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      router.replace("/app");
      return;
    }
    openLogin({ ...copy, serviceDomain: "ROXIRA", onSuccess: () => router.push("/app") });
  }, [copy, isAuthenticated, isLoading, openLogin, router]);

  return (
    <div dir="rtl" className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-black text-white">{copy.title}</h1>
        <p className="text-sm leading-relaxed text-slate-400">{copy.description}</p>
        <button
          type="button"
          onClick={() =>
            openLogin({ ...copy, serviceDomain: "ROXIRA", onSuccess: () => router.push("/app") })
          }
          className="rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-6 py-3 text-sm font-bold text-white"
        >
          {mode === "login" ? "ورود" : "ثبت‌نام"}
        </button>
        <Link
          href={mode === "login" ? "/signup" : "/login"}
          className="text-xs text-indigo-300 hover:text-indigo-200"
        >
          {mode === "login" ? "حساب ندارید؟ ثبت‌نام کنید" : "حساب دارید؟ وارد شوید"}
        </Link>
      </main>
    </div>
  );
}
