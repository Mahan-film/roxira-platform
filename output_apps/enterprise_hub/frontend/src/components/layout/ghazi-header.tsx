"use client";
import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleHelp,
  LogOut,
  Menu,
  User,
  X,
} from "lucide-react";
import { GhaziMark } from "@/components/brand/GhaziMark";
import { useAuth } from "@/components/auth/auth-provider";
import { ApDropdown } from "@/components/layout/ap-dropdown";

interface NavDest {
  href: string;
  label: string;
}

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
  return (
    <Link href={dest.href} {...common}>
      {dest.label}
    </Link>
  );
}

export function GhaziHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isAuthenticated, openLogin, logout, user } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);

  const handleOpenAuth = () => {
    openLogin({
      serviceDomain: "GHAZI",
      title: "ورود به سامانه قاضی هوشمند",
      description: "شماره همراه خود را وارد کنید؛ کد تأیید پیامکی ارسال می‌شود.",
    });
  };

  const closeMobile = () => setMobileOpen(false);

  const accountSection = (close: () => void, role?: "menuitem") => (
    <>
      <div className="ap-menu-label">{isAuthenticated ? "وارد شده‌اید" : "وارد نشده‌اید"}</div>
      {isAuthenticated && user?.phone && (
        <div className="ap-menuitem" style={{ cursor: "default" }} dir="ltr">
          {user.phone}
        </div>
      )}
      {isAuthenticated && (
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
      )}
      <div className="ap-menu-sep" role="separator" />
      {INFO_LINKS.map((d) => (
        <DestLink key={d.href} dest={d} className="ap-menuitem" role={role} current={pathname === d.href} onNavigate={close} />
      ))}
    </>
  );

  return (
    <>
      <header className="ap-theme ghazi-theme ap-header" data-theme="dark" dir="rtl" lang="fa">
        <div className="ap-header-row">
          <Link href="/chat" className="ap-brand">
            <span className="ap-brand-mark" aria-hidden="true">
              <GhaziMark className="size-9" />
            </span>
            <span>قاضی هوشمند</span>
          </Link>

          {/* Desktop primary navigation */}
          <nav className="ap-nav-list" aria-label="ناوبری اصلی">
            <DestLink dest={{ href: "/chat", label: "گفتگوی حقوقی" }} className="ap-navlink" current={pathname === "/chat"} />
            <DestLink dest={{ href: "/plans", label: "اشتراک" }} className="ap-navlink" current={pathname === "/plans"} />
          </nav>

          <div className="ap-header-end">
            <Link href="/guide" className="ap-iconbtn" aria-label="راهنمای استفاده" title="راهنمای استفاده">
              <CircleHelp className="size-5" aria-hidden="true" />
            </Link>
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

        {/* Mobile / tablet panel: four items; account details expand on demand */}
        {mobileOpen && (
          <div className="ap-mobile-panel ap-only-mobile">
            <DestLink dest={{ href: "/chat", label: "چت" }} className="ap-menuitem" current={pathname === "/chat"} onNavigate={closeMobile} />
            <DestLink dest={{ href: "/guide", label: "راهنما" }} className="ap-menuitem" current={pathname === "/guide"} onNavigate={closeMobile} />
            <DestLink dest={{ href: "/plans", label: "اشتراک" }} className="ap-menuitem" current={pathname === "/plans"} onNavigate={closeMobile} />
            <button
              type="button"
              className="ap-menuitem"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((v) => !v)}
            >
              <User className="size-4" aria-hidden="true" />
              <span>حساب</span>
              <span className="ap-muted ms-auto text-[13px]">{isAuthenticated ? "وارد شده‌اید" : "مهمان"}</span>
            </button>
            {accountOpen && accountSection(closeMobile)}
          </div>
        )}
      </header>
    </>
  );
}

export default GhaziHeader;
