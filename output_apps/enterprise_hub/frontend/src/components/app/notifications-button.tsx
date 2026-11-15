"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

interface NotificationItem {
  id: string;
  title: string;
  description: string;
  href: string;
  time: string;
  type: "warning" | "info" | "success";
}

const SAMPLE_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "notif-1",
    title: "چک‌های سررسید نزدیک",
    description: "۲ فقره چک دریافتی در ۷ روز آینده سررسید می‌شوند.",
    href: "/app/cheques",
    time: "امروز",
    type: "warning",
  },
  {
    id: "notif-2",
    title: "کارپوشه مالیاتی",
    description: "تطبیق کارپوشه سامانه مودیان به‌روز شد.",
    href: "/app/tax",
    time: "دیروز",
    type: "info",
  },
];

export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="اعلان‌ها"
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex size-10 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="size-4" aria-hidden="true" />
        {SAMPLE_NOTIFICATIONS.length > 0 && (
          <span className="absolute top-2.5 end-2.5 flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-indigo-500" />
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="فهرست اعلان‌ها"
          className="absolute end-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-border bg-card p-2 shadow-2xl animate-in fade-in-0 zoom-in-95"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <span className="text-xs font-bold text-foreground">اعلان‌های سیستم</span>
            <span className="text-[10px] text-muted-foreground">
              {SAMPLE_NOTIFICATIONS.length.toLocaleString("fa-IR")} پیام جدید
            </span>
          </div>

          <div className="mt-1 flex flex-col gap-1 max-h-72 overflow-y-auto">
            {SAMPLE_NOTIFICATIONS.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-muted"
              >
                <div className="mt-0.5 shrink-0">
                  {item.type === "warning" ? (
                    <AlertTriangle className="size-3.5 text-amber-400" aria-hidden="true" />
                  ) : item.type === "success" ? (
                    <CheckCircle2 className="size-3.5 text-emerald-400" aria-hidden="true" />
                  ) : (
                    <Clock className="size-3.5 text-indigo-400" aria-hidden="true" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs font-semibold text-foreground">{item.title}</span>
                  <span className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.description}
                  </span>
                  <span className="mt-1 text-[10px] text-muted-foreground/80">{item.time}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
