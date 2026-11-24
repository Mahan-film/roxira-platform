"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Menu, X } from "lucide-react";

import { AccountButton } from "@/components/en/account-button";
import { PasskeyLoginButton } from "@/components/en/passkey-login-button";

const NAV_ITEMS = [
  { href: "#modules", label: "Modules" },
  { href: "#api", label: "API" },
  { href: "#fx", label: "FX & Settlement" },
  { href: "#pricing", label: "Pricing & Tiers" },
] as const;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface EnSiteHeaderProps {
  onRequestApiAccess: () => void;
}

/**
 * Responsive, RTL-safe header for the roxira.net marketing landing page.
 * Keeps the primary CTA visible at 320-768 px and provides an accessible
 * mobile navigation drawer with focus trap and Escape-to-close.
 */
export function EnSiteHeader({ onRequestApiAccess }: EnSiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback((restoreFocus = true) => {
    setMenuOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const panel = panelRef.current;
    if (panel) {
      const firstFocusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      firstFocusable?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu(true);
        return;
      }

      if (e.key !== "Tab" || !panelRef.current) return;

      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null);

      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panelRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, closeMenu]);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#020617]/90 text-slate-100 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6 sm:py-3.5">
        <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black text-white shadow-lg shadow-indigo-600/30">
            R
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-xs font-bold text-white sm:text-sm">
              Roxira<span className="hidden sm:inline"> International</span>
            </span>
            <span className="font-mono text-[10px] text-slate-500" dir="ltr">
              roxira.net
            </span>
          </span>
        </Link>

        <nav aria-label="Primary navigation" className="hidden items-center gap-1 text-sm lg:flex">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <div className="hidden items-center gap-2 lg:flex">
            <AccountButton />
            <PasskeyLoginButton />
          </div>

          <button
            type="button"
            onClick={onRequestApiAccess}
            data-testid="header-request-api-cta"
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-2.5 py-2 text-[11px] font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5 sm:px-4 sm:text-xs"
          >
            <BookOpen className="hidden size-3.5 sm:inline-block" aria-hidden="true" />
            Request API access
          </button>

          <button
            ref={triggerRef}
            type="button"
            onClick={() => (menuOpen ? closeMenu(false) : setMenuOpen(true))}
            aria-expanded={menuOpen}
            aria-controls="en-mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            data-testid="en-mobile-menu-toggle"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/15 text-slate-200 transition-colors hover:bg-white/10 lg:hidden"
          >
            {menuOpen ? (
              <X className="size-4" aria-hidden="true" />
            ) : (
              <Menu className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 top-[57px] z-50 lg:hidden">
          <div
            aria-hidden="true"
            onClick={() => closeMenu(true)}
            className="fixed inset-0 top-[57px] bg-black/60 backdrop-blur-xs"
          />
          <div
            ref={panelRef}
            id="en-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            className="relative z-10 border-b border-white/10 bg-[#020617] px-4 py-4 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Navigation
              </span>
              <button
                type="button"
                onClick={() => closeMenu(true)}
                aria-label="Close menu"
                className="inline-flex size-8 items-center justify-center rounded-lg border border-white/15 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <nav aria-label="Mobile links">
              <ul className="space-y-1">
                {NAV_ITEMS.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      onClick={() => closeMenu(false)}
                      className="block rounded-lg px-3 py-2.5 text-start text-sm font-medium text-slate-200 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
              <AccountButton />
              <PasskeyLoginButton />
              <button
                type="button"
                onClick={() => {
                  closeMenu(false);
                  onRequestApiAccess();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30"
              >
                <BookOpen className="size-3.5" aria-hidden="true" />
                Request API access
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
