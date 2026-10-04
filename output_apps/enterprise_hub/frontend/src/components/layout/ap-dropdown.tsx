"use client";
import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

interface ApDropdownProps {
  /** Visible label; omit for an icon-only trigger (then ariaLabel is required). */
  label?: string;
  ariaLabel?: string;
  icon?: React.ReactNode;
  /** Trigger class: "ap-navlink" (text) or "ap-iconbtn" (icon only). */
  triggerClassName?: string;
  align?: "start" | "end";
  active?: boolean;
  children: (close: () => void) => React.ReactNode;
}

/** Small accessible disclosure menu: Escape and outside click close it. */
export function ApDropdown({
  label,
  ariaLabel,
  icon,
  triggerClassName = "ap-navlink",
  align = "start",
  active,
  children,
}: ApDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="ap-dropdown" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        aria-current={active ? "page" : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label && <span>{label}</span>}
        {label && <ChevronDown className="size-3.5" aria-hidden="true" />}
      </button>
      {open && (
        <div id={menuId} role="menu" className="ap-menu" data-align={align}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export default ApDropdown;
