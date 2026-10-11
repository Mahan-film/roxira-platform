"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

export interface PortalNavLink {
  href: string;
  label: string;
}

/** Hamburger menu for the roxira.ir portal headers (the desktop nav is hidden below md). */
export function PortalMobileNav({ links }: { links: PortalNavLink[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="portal-mobile-menu"
        aria-label={open ? "بستن منو" : "باز کردن منو"}
        className="inline-flex size-10 items-center justify-center rounded-xl border border-white/15 text-slate-200"
      >
        {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
      </button>
      {open && (
        <nav
          id="portal-mobile-menu"
          aria-label="منوی اصلی"
          className="absolute inset-x-0 top-full border-b border-white/10 bg-slate-950 px-4 py-3"
        >
          <ul className="mx-auto max-w-6xl space-y-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-3 text-sm text-slate-200 hover:bg-white/5"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
