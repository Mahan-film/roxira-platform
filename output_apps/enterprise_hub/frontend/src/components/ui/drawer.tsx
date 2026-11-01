"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DrawerProps {
  open: boolean;
  title: string;
  description?: string;
  /** Wide drawers suit line-item forms; narrow ones suit short forms. */
  size?: "md" | "lg" | "xl";
  onClose: () => void;
  children: ReactNode;
}

const SIZES = {
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
} as const;

/**
 * Side panel for create/edit forms so the list underneath stays in view. It opens from the
 * start edge (the right in RTL), closes on Escape, the backdrop or the close button, and keeps
 * keyboard focus inside while open.
 */
export function Drawer({
  open,
  title,
  description,
  size = "lg",
  onClose,
  children,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-start" role="presentation">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative flex h-full w-full flex-col bg-background shadow-xl outline-none",
          SIZES[size],
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            {description && (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="بستن"
          >
            <X />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
