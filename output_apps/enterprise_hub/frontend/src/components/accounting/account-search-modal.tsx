"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ACCOUNT_TYPE_LABELS, type ChartOfAccount } from "@/types/accounting";

interface AccountSearchModalProps {
  open: boolean;
  accounts: ChartOfAccount[];
  onSelect: (account: ChartOfAccount) => void;
  onClose: () => void;
}

export function AccountSearchModal({
  open,
  accounts,
  onSelect,
  onClose,
}: AccountSearchModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts.slice(0, 50);
    return accounts
      .filter((a) => {
        const codeMatch = a.code.toLowerCase().includes(q);
        const nameMatch = a.name.toLowerCase().includes(q);
        const typeMatch = (ACCOUNT_TYPE_LABELS[a.accountType] || "").toLowerCase().includes(q);
        return codeMatch || nameMatch || typeMatch;
      })
      .slice(0, 50);
  }, [accounts, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredAccounts]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const activeEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, open]);

  if (!open) return null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredAccounts.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = filteredAccounts[selectedIndex];
      if (chosen) {
        onSelect(chosen);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-16 backdrop-blur-sm sm:pt-24"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="flex w-full max-w-xl flex-col rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <SearchIcon className="size-5 text-indigo-500" />
            <h3 className="font-semibold text-foreground">جستجوی حساب (F2)</h3>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} title="بستن (Esc)">
            <XIcon className="size-4" />
          </Button>
        </div>

        <div className="p-3">
          <div className="relative">
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="کد یا نام حساب را وارد کنید... (Enter انتخاب، Esc بستن)"
              className="pr-9 font-medium"
            />
            <SearchIcon className="absolute right-3 top-2.5 size-4 text-muted-foreground" />
          </div>
        </div>

        <div
          ref={listRef}
          className="max-h-80 overflow-y-auto px-2 pb-3"
          tabIndex={-1}
        >
          {filteredAccounts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              حسابی با این مشخصات یافت نشد.
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {filteredAccounts.map((account, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <li
                    key={account.id}
                    data-index={idx}
                    className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                      isSelected
                        ? "bg-indigo-50 text-indigo-900 ring-1 ring-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-200"
                        : "hover:bg-muted"
                    }`}
                    onClick={() => onSelect(account)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-bold text-muted-foreground">
                        {account.code}
                      </span>
                      <span className="font-medium">{account.name}</span>
                    </div>
                    <Badge variant="outline" className="text-[11px]">
                      {ACCOUNT_TYPE_LABELS[account.accountType]}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">↑↓</kbd> جابجایی
            </span>
            <span>
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">Enter</kbd> انتخاب
            </span>
            <span>
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">Esc</kbd> بستن
            </span>
          </div>
          <span>{filteredAccounts.length} حساب</span>
        </div>
      </div>
    </div>
  );
}
