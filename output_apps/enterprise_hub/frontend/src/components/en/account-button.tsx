"use client";

import Link from "next/link";
import { LogIn, PanelsTopLeft } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";

/** Header entry on the international portal: sign in / create account, or open the panel. */
export function AccountButton() {
  const { isAuthenticated, isLoading, openLogin } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) {
    return (
      <Link
        href="/en/app"
        className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-white/5"
      >
        <PanelsTopLeft className="size-3.5" />
        Open panel
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() =>
        openLogin({
          serviceDomain: "ROXIRA",
          locale: "en",
          title: "Sign in to Roxira",
          description: "Sign in or create an account with your email and a password.",
        })
      }
      className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-white/5"
    >
      <LogIn className="size-3.5" />
      Sign in
    </button>
  );
}
