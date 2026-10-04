"use client";
import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Coins,
  LogOut,
  Menu,
  Scale,
  User,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { SubscriptionModal } from "@/components/judge/subscription/subscription-modal";
import { ApDropdown } from "@/components/layout/ap-dropdown";
import { DRAFT_ACTIONS, DRAFT_PAGES, draftActionHref } from "@/lib/chat-actions";

interface NavDest {
  href: string;
  label: string;
  /** "/damages" is not served on the Ghazi domain (middleware redirects to roxira.ir):
   *  a plain <a> avoids Next client navigation hitting a cross-origin RSC fetch. */
  external?: boolean;
}

const MAIN_LINKS: NavDest[] = [
  { href: "/chat", label: "گفتگوی حقوقی" },
  { href: "/damages", label: "محاسبه‌گر خسارت", external: true },
  { href: "/services", label: "محصولات و اشتراک" },
  { href: "/technology", label: "تکنولوژی" },
];

const DRAFT_LINKS: NavDest[] = [
  ...DRAFT_PAGES.map((p) => ({ href: p.href, label: p.label })),
  ...DRAFT_ACTIONS.map((a) => ({ href: draftActionHref(a.key), label: a.label })),
];

const INFO_LINKS: NavDest[] = [
  { href: "/about", label: "درباره سامانه" },
  { href: "/contact", label: "تماس با ما" },
  { href: "/terms", label: "قوانین و مقررات" },
  { href: "/privacy", label: "حریم خصوصی" },
];

function DestLink({
  dest,
  className,
  current,
  role,
  onNavigate,
}: {
  dest: NavDest;
  className: string;
  current: boolean;
  role?: "menuitem";
  onNavigate?: () => void;
}) {
  const common = {
    className,
    role,
    "aria-current": current ? ("page" as const) : undefined,
    onClick: onNavigate,
  };
  return dest.external ? (
    <a href={dest.href} {...common}>
      {dest.label}
    </a>
  ) : (
    <Link href={dest.href} {...common}>
      {dest.label}
    </Link>
  );
}

export function GhaziHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const { isAuthenticated, openLogin, logout, accessToken, user } = useAuth();

  const handleOpenAuth = () => {
    openLogin({
      serviceDomain: "GHAZI",
      title: "ورود به سامانه قاضی هوشمند",
      description: "شماره همراه خود را وارد کنید؛ کد تأیید پیامکی ارسال می‌شود.",
    });
  };

  const draftsActive = pathname.startsWith("/draft-");
  const closeMobile = () => setMobileOpen(false);

  const accountSection = (close: () => void, role?: "menuitem") => (
    <>
      {isAuthenticated ? (
        <>
          <div className="ap-menu-label">حساب کاربری</div>
          <div className="ap-menuitem" style={{ cursor: "default" }}>
            <Coins className="size-4" aria-hidden="true" />
            <span>توکن باقی‌مانده: 0</span>
          </div>
          <button
            type="button"
            role={role}
            className="ap-menuitem"
            onClick={() => {
              close();
              setTopUpOpen(true);
            }}
          >
            افزایش موجودی
          </button>
          <button
            type="button"
            role={role}
            className="ap-menuitem"
            data-danger="true"
            onClick={() => {
              close();
              logout();
            }}
          >
            <LogOut className="size-4" aria-hidden="true" />
            <span>خروج از حساب کاربری</span>
          </button>
        </>
      ) : (
        <button
          type="button"
          role={role}
          className="ap-menuitem"
          onClick={() => {
            close();
            handleOpenAuth();
          }}
        >
          <User className="size-4" aria-hidden="true" />
          <span>ورود با پیامک (OTP)</span>
        </button>
      )}
      <div className="ap-menu-sep" role="separator" />
      <div className="ap-menu-label">اطلاعات</div>
      {INFO_LINKS.map((d) => (
        <DestLink key={d.href} dest={d} className="ap-menuitem" role={role} current={pathname === d.href} onNavigate={close} />
      ))}
    </>
  );

  return (
    <>
      <header className="ap-theme ap-header" data-theme="dark" dir="rtl" lang="fa">
        <div className="ap-header-row">
          <Link href="/chat" className="ap-brand">
            <span className="ap-brand-mark" aria-hidden="true">
              <Scale className="size-5" />
            </span>
            <span>قاضی هوشمند</span>
          </Link>

          {/* Desktop primary navigation */}
          <nav className="ap-nav-list" aria-label="ناوبری اصلی">
            <DestLink dest={MAIN_LINKS[0]} className="ap-navlink" current={pathname === "/chat"} />
            <ApDropdown label="پیش‌نویس‌ها" active={draftsActive}>
              {(close) => (
                <>
                  <div className="ap-menu-label">صفحه‌های اختصاصی</div>
                  {DRAFT_LINKS.slice(0, DRAFT_PAGES.length).map((d) => (
                    <DestLink key={d.href} dest={d} className="ap-menuitem" role="menuitem" current={pathname === d.href} onNavigate={close} />
                  ))}
                  <div className="ap-menu-sep" role="separator" />
                  <div className="ap-menu-label">در گفتگو</div>
                  {DRAFT_LINKS.slice(DRAFT_PAGES.length).map((d) => (
                    <DestLink key={d.href} dest={d} className="ap-menuitem" role="menuitem" current={false} onNavigate={close} />
                  ))}
                </>
              )}
            </ApDropdown>
            {MAIN_LINKS.slice(1).map((d) => (
              <DestLink key={d.href} dest={d} className="ap-navlink" current={pathname === d.href} />
            ))}
          </nav>

          <div className="ap-header-end">
            {!isAuthenticated && (
              <button type="button" className="ap-btn" onClick={handleOpenAuth}>
                <span>ورود</span>
              </button>
            )}
            <span className="ap-only-desktop">
              <ApDropdown
                triggerClassName="ap-iconbtn"
                ariaLabel="حساب کاربری و اطلاعات بیشتر"
                icon={<User className="size-5" aria-hidden="true" />}
                align="end"
              >
                {(close) => accountSection(close, "menuitem")}
              </ApDropdown>
            </span>
            <button
              type="button"
              className="ap-iconbtn ap-only-mobile"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? "بستن منو" : "باز کردن منو"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {/* Mobile / tablet panel: everything grouped, no horizontal scrolling bar */}
        {mobileOpen && (
          <div className="ap-mobile-panel ap-only-mobile">
            <DestLink dest={MAIN_LINKS[0]} className="ap-menuitem" current={pathname === "/chat"} onNavigate={closeMobile} />
            <div className="ap-menu-label">پیش‌نویس‌ها</div>
            {DRAFT_LINKS.map((d) => (
              <DestLink key={d.href} dest={d} className="ap-menuitem" current={pathname === d.href} onNavigate={closeMobile} />
            ))}
            <div className="ap-menu-sep" role="separator" />
            {MAIN_LINKS.slice(1).map((d) => (
              <DestLink key={d.href} dest={d} className="ap-menuitem" current={pathname === d.href} onNavigate={closeMobile} />
            ))}
            <div className="ap-menu-sep" role="separator" />
            {accountSection(closeMobile)}
            <div className="ap-menu-sep" role="separator" />
            <div className="ap-menuitem" style={{ cursor: "default" }}>
              <span>
                مرکز تماس:{" "}
                <a href="tel:09129367796" className="ap-link" dir="ltr">
                  09129367796
                </a>
              </span>
            </div>
          </div>
        )}
      </header>

      {/* Rendered outside the header: its backdrop-filter would trap a fixed overlay. */}
      <SubscriptionModal
        isOpen={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        currentPlan="عادی"
        accessToken={accessToken}
        phone={user?.phone}
      />
    </>
  );
}

export default GhaziHeader;
