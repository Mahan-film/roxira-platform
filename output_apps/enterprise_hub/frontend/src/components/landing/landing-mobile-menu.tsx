'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { LANDING_NAV, LOGIN_HREF } from './landing-nav';

/** Hamburger + full-screen menu for < lg. Esc closes, focus moves in and returns to the button. */
export function LandingMobileMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    firstLinkRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="landing-mobile-menu"
        aria-label={open ? 'بستن منو' : 'باز کردن منو'}
        onClick={() => setOpen((v) => !v)}
        className="gl-glass gl-focus flex h-10 w-10 items-center justify-center rounded-xl text-slate-200"
      >
        <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      {open ? (
        <div
          id="landing-mobile-menu"
          className="fixed inset-x-0 bottom-0 top-14 z-40 overflow-y-auto bg-[#05080f]/95 px-4 pb-8 pt-4 backdrop-blur-xl sm:top-16"
        >
          <nav aria-label="منوی صفحات" className="mx-auto flex max-w-md flex-col gap-1.5">
            {LANDING_NAV.map((n, i) => (
              <Link
                key={n.href}
                href={n.href}
                ref={i === 0 ? firstLinkRef : undefined}
                onClick={() => setOpen(false)}
                className="gl-focus flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-base font-bold text-slate-100 transition-colors hover:border-amber-400/40 hover:text-amber-300"
              >
                {n.label}
                <svg aria-hidden="true" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
                </svg>
              </Link>
            ))}
            <Link
              href={LOGIN_HREF}
              onClick={() => setOpen(false)}
              className="gl-btn gl-focus mt-3 inline-flex h-12 items-center justify-center rounded-xl text-base font-black"
            >
              ورود / ثبت‌نام سریع
            </Link>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
