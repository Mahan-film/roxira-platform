"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, type LucideIcon } from "lucide-react";

import { useAccess } from "@/components/app/access-provider";
import { useImportHandoff } from "@/components/app/import-handoff";
import { navIcon } from "@/components/app/nav-icons";
import { QUICK_CREATE, visibleGroups } from "@/lib/nav-menu";
import { useAssistantEnabled } from "@/lib/use-assistant-enabled";
import { cn } from "@/lib/utils";

interface CommandAction {
  id: string;
  labelFa: string;
  labelEn: string;
  /** Extra Persian/English terms that should match this action. */
  keywords: string[];
  icon: LucideIcon;
  run: () => void;
}

/**
 * Subsequence fuzzy score: every character of the query must appear in order.
 * Higher is better; 0 means no match. Contiguous runs and prefix matches score
 * higher so «مشتری» ranks «مشتریان» above unrelated labels.
 */
function fuzzyScore(query: string, target: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = target.toLowerCase();
  let score = 0;
  let cursor = 0;
  let streak = 0;
  for (const char of q) {
    const found = t.indexOf(char, cursor);
    if (found === -1) return 0;
    streak = found === cursor ? streak + 1 : 0;
    score += 1 + streak + (found === 0 ? 2 : 0);
    cursor = found + 1;
  }
  return score;
}

export function CommandPalette({
  open,
  onOpenChange,
  mode = "all",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "all" shows navigation plus create actions; "create" only the create actions. */
  mode?: "all" | "create";
}) {
  const router = useRouter();
  const { setPendingFile, setPendingTab } = useImportHandoff();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const assistantEnabled = useAssistantEnabled() === true;

  const { can } = useAccess();
  const actions = useMemo<CommandAction[]>(() => {
    const go = (href: string) => () => {
      onOpenChange(false);
      router.push(href);
    };
    const goImport = (tab: "file" | "package") => () => {
      setPendingFile(null);
      setPendingTab(tab);
      onOpenChange(false);
      router.push("/app/import");
    };
    // Create actions: the QUICK_CREATE list, gated on the role's create rights.
    // «ورود فایل» still routes through the import handoff to open the file tab.
    const createActions: CommandAction[] = QUICK_CREATE.filter((entry) =>
      can(entry.module, entry.action),
    ).map((entry) => ({
      id: entry.id,
      labelFa: entry.label,
      labelEn: "ثبت جدید",
      keywords: entry.keywords,
      icon: navIcon(entry.icon),
      run: entry.id === "import-file" ? goImport("file") : go(entry.href),
    }));
    if (mode === "create") return createActions;
    // Navigation actions generated from the same visible menu tree as the sidebar.
    const navActions: CommandAction[] = visibleGroups(can, { assistantEnabled }).flatMap(
      (group) =>
        group.items.map((leaf) => ({
          id: leaf.href,
          labelFa: leaf.label,
          labelEn: group.label,
          keywords: [group.label, ...(leaf.keywords ?? [])],
          icon: navIcon(leaf.icon),
          run: go(leaf.href),
        })),
    );
    return [
      ...navActions,
      ...createActions,
      ...(can("data_import", "create")
        ? [
            {
              id: "import-database",
              labelFa: "انتقال کامل دیتابیس",
              labelEn: "انتقال کامل دیتابیس",
              keywords: ["دیتابیس", "مهاجرت", "sqlite", "sql", "zip", "database", "migration"],
              icon: navIcon("Database"),
              run: goImport("package"),
            } satisfies CommandAction,
          ]
        : []),
    ];
  }, [assistantEnabled, can, mode, onOpenChange, router, setPendingFile, setPendingTab]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return actions;
    return actions
      .map((action) => ({
        action,
        score: Math.max(
          fuzzyScore(q, action.labelFa),
          fuzzyScore(q, action.labelEn),
          ...action.keywords.map((keyword) => fuzzyScore(q, keyword)),
        ),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.action);
  }, [actions, query]);

  // Global Cmd+K / Ctrl+K toggle.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Reset the query each time the palette opens (adjusted during render).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }

  // Focus the input each time the palette opens.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        Math.max(0, Math.min(index + 1, results.length - 1)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      results[activeIndex]?.run();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:pt-[12vh]"
      role="presentation"
    >
      <button
        type="button"
        aria-label="بستن پالت فرمان‌ها"
        className="absolute inset-0 bg-black/60"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="پالت فرمان‌ها"
        className="relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-w-xl sm:rounded-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={
              results[activeIndex] ? `command-${results[activeIndex].id}` : undefined
            }
            aria-autocomplete="list"
            placeholder="جست‌وجو یا فرمان… (مثلاً: مشتری جدید)"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="بستن"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <ul
          ref={listRef}
          id="command-list"
          role="listbox"
          aria-label="فرمان‌ها"
          className="flex flex-1 flex-col gap-1 overflow-y-auto p-2"
        >
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              نتیجه‌ای یافت نشد.
            </li>
          )}
          {results.map((action, index) => {
            const Icon = action.icon;
            return (
              <li
                key={action.id}
                id={`command-${action.id}`}
                role="option"
                aria-selected={index === activeIndex}
                data-index={index}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => action.run()}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                  index === activeIndex
                    ? "bg-indigo-500/15 text-foreground ring-1 ring-indigo-500/30"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex flex-col leading-tight">
                  <span className="font-medium">{action.labelFa}</span>
                  <span className="font-mono text-[10px]" dir="ltr">
                    {action.labelEn}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
