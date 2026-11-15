"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Branch {
  id: string;
  name: string;
  code: string;
}

const DEFAULT_BRANCHES: Branch[] = [
  { id: "main", name: "شعبه مرکزی", code: "۰۱" },
  { id: "online", name: "فروشگاه آنلاین", code: "۰۲" },
];

export function BranchSwitcher() {
  const [open, setOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<Branch>(DEFAULT_BRANCHES[0]);
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
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`تغییر شعبه: ${selectedBranch.name}`}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/50 px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Building2 className="size-3.5 text-indigo-400 shrink-0" aria-hidden="true" />
        <span className="font-medium">{selectedBranch.name}</span>
        <ChevronDown
          className={cn("size-3 text-muted-foreground transition-transform", open ? "rotate-180" : "")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="انتخاب شعبه"
          className="absolute start-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-border bg-card p-1 shadow-xl animate-in fade-in-0 zoom-in-95"
        >
          <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground border-b border-border/60">
            انتخاب شعبه فعال
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {DEFAULT_BRANCHES.map((branch) => {
              const isSelected = branch.id === selectedBranch.id;
              return (
                <button
                  key={branch.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    setSelectedBranch(branch);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors",
                    isSelected
                      ? "bg-indigo-500/15 text-indigo-300 font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Building2 className="size-3 shrink-0" aria-hidden="true" />
                    <span>{branch.name}</span>
                  </span>
                  {isSelected && <Check className="size-3.5 text-indigo-400" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
