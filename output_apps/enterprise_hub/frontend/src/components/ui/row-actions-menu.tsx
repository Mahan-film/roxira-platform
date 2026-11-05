"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";

export interface RowAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** Kebab menu for a table row. Closes on outside click, Esc or after a choice. */
export function RowActionsMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Fixed coordinates, so an `overflow-x-auto` table wrapper (which also clips
  // vertically) cannot cut the menu off in the last row.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) {
      setPos(null);
      return;
    }
    const b = button.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    const rtl = getComputedStyle(button.current).direction === "rtl";
    let top = b.bottom + 4;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, b.top - 4 - m.height);
    let left = rtl ? b.left : b.right - m.width;
    left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - m.width - 8));
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={root} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
          className="fixed z-40 flex min-w-44 flex-col rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
        >
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
              className="rounded-md px-3 py-2 text-start hover:bg-muted disabled:opacity-50"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
