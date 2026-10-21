"use client";
/**
 * Recent-chats drawer for logged-in users (guests never see it).
 * Self-contained: it lists and loads saved chats and hands the result to ChatShell via two callbacks.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History, Loader2, Plus, X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  ConversationsError,
  listConversations,
  loadConversation,
  type ConversationSummary,
  type StoredConversation,
} from "@/lib/api/conversations-client";
import { formatPersianDate } from "@/lib/format";

export const HISTORY_COPY = {
  open: "گفتگوهای قبلی",
  title: "گفتگوهای قبلی",
  close: "بستن",
  newChat: "گفتگوی جدید",
  empty: "هنوز گفتگوی ذخیره‌شده‌ای ندارید.",
  untitled: "گفتگو بدون عنوان",
  listFailed: "فهرست گفتگوها بارگذاری نشد.",
  openFailed: "این گفتگو باز نشد؛ دوباره تلاش کنید.",
  expired: "نشست شما منقضی شده؛ دوباره وارد شوید.",
  retry: "تلاش دوباره",
  unsavedWarn: "پیام یا پیش‌نویس ذخیره‌نشده‌ای دارید که با ادامه از بین می‌رود.",
  unsavedGo: "ادامه و رد کردن",
  unsavedStay: "ماندن در گفتگوی فعلی",
  busy: "تا پایان پردازش فعلی صبر کنید.",
} as const;

interface ChatHistoryProps {
  activeId: string;
  /** A reply is streaming or a file is uploading/reading: switching is blocked. */
  busy: boolean;
  /** Typed-but-unsent text, an open drafting session or a pending attachment. */
  hasUnsaved: boolean;
  onRestore: (id: string, conversation: StoredConversation) => void;
  onNew: () => void;
}

type Pending = { kind: "open"; id: string } | { kind: "new" };

export function ChatHistory({ activeId, busy, hasUnsaved, onRestore, onNew }: ChatHistoryProps) {
  const { isAuthenticated, getAccessToken, expireSession } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ConversationsError && err.status === 401) {
        expireSession();
        setError(HISTORY_COPY.expired);
      } else {
        setError(fallback);
      }
    },
    [expireSession],
  );

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    setError("");
    try {
      const list = await listConversations(getAccessToken(), ctl.signal);
      if (!ctl.signal.aborted) setItems(list);
    } catch (err) {
      if (!ctl.signal.aborted) fail(err, HISTORY_COPY.listFailed);
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [fail, getAccessToken]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const openDrawer = () => {
    setPending(null);
    setOpen(true);
    void refresh();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const doOpen = async (id: string) => {
    setOpening(id);
    setError("");
    try {
      const conv = await loadConversation(id, getAccessToken());
      onRestore(id, conv);
      setOpen(false);
    } catch (err) {
      fail(err, HISTORY_COPY.openFailed);
    } finally {
      setOpening("");
    }
  };

  const request = (p: Pending) => {
    if (busy) return;
    if (p.kind === "open" && p.id === activeId) {
      setOpen(false);
      return;
    }
    if (hasUnsaved) {
      setPending(p);
      return;
    }
    void run(p);
  };

  const run = async (p: Pending) => {
    setPending(null);
    if (p.kind === "new") {
      onNew();
      setOpen(false);
    } else {
      await doOpen(p.id);
    }
  };

  if (!isAuthenticated) return null;

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-2 sm:px-6">
        <button type="button" className="ap-chip ap-chip-sm" onClick={openDrawer} aria-haspopup="dialog">
          <History className="size-4" aria-hidden="true" />
          <span>{HISTORY_COPY.open}</span>
        </button>
        <button type="button" className="ap-chip ap-chip-sm" onClick={() => request({ kind: "new" })} disabled={busy}>
          <Plus className="size-4" aria-hidden="true" />
          <span>{HISTORY_COPY.newChat}</span>
        </button>
      </div>

      {open &&
        isAuthenticated &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="ap-theme ghazi-theme" data-theme="dark" dir="rtl" lang="fa" style={{ background: "transparent", position: "fixed", inset: 0, zIndex: 80 }}>
            <button
              type="button"
              aria-label={HISTORY_COPY.close}
              onClick={() => setOpen(false)}
              style={{ position: "absolute", inset: 0, background: "rgb(0 0 0 / 0.6)", border: 0, cursor: "default" }}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={HISTORY_COPY.title}
              style={{
                position: "absolute",
                insetBlock: 0,
                insetInlineStart: 0,
                width: "min(100%, 360px)",
                display: "flex",
                flexDirection: "column",
                background: "var(--ap-menu-bg)",
                borderInlineEnd: "1px solid var(--ap-line)",
                boxShadow: "var(--ap-menu-shadow)",
              }}
            >
              <div className="flex items-center justify-between gap-2 p-3" style={{ borderBottom: "1px solid var(--ap-line)" }}>
                <h2 className="text-base font-semibold">{HISTORY_COPY.title}</h2>
                <button type="button" className="ap-iconbtn" onClick={() => setOpen(false)} aria-label={HISTORY_COPY.close}>
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>

              <div className="p-3">
                <button type="button" className="ap-menuitem" style={{ border: "1px solid var(--ap-line)" }} onClick={() => request({ kind: "new" })} disabled={busy}>
                  <Plus className="size-4" aria-hidden="true" />
                  <span>{HISTORY_COPY.newChat}</span>
                </button>
              </div>

              {busy && <p className="ap-notice px-4 pb-2" role="status">{HISTORY_COPY.busy}</p>}

              {pending && (
                <div className="mx-3 mb-3 rounded-xl p-3" style={{ background: "var(--ap-surface-2)", border: "1px solid var(--ap-warn)" }} role="alertdialog" aria-label={HISTORY_COPY.unsavedWarn}>
                  <p className="ap-notice ap-notice-warn mb-2">{HISTORY_COPY.unsavedWarn}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="ap-chip ap-chip-sm" data-danger="true" onClick={() => void run(pending)}>
                      {HISTORY_COPY.unsavedGo}
                    </button>
                    <button type="button" className="ap-chip ap-chip-sm" onClick={() => setPending(null)}>
                      {HISTORY_COPY.unsavedStay}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-3 pb-4">
                {loading && (
                  <div className="ap-notice flex items-center gap-2 p-3" role="status">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  </div>
                )}
                {error && (
                  <p className="ap-notice p-3" style={{ color: "var(--ap-danger)" }} role="alert">
                    {error}{" "}
                    {error !== HISTORY_COPY.expired && (
                      <button type="button" className="ap-link underline" onClick={() => void refresh()}>
                        {HISTORY_COPY.retry}
                      </button>
                    )}
                  </p>
                )}
                {!loading && !error && items && items.length === 0 && <p className="ap-notice p-3">{HISTORY_COPY.empty}</p>}
                <ul className="m-0 list-none space-y-1 p-0">
                  {(items ?? []).map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="ap-menuitem"
                        style={{ flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 2, padding: "8px 12px", background: c.id === activeId ? "var(--ap-hover)" : undefined }}
                        aria-current={c.id === activeId ? "true" : undefined}
                        disabled={Boolean(opening)}
                        onClick={() => request({ kind: "open", id: c.id })}
                      >
                        <span className="w-full truncate" dir="auto">{c.title || HISTORY_COPY.untitled}</span>
                        <span className="ap-notice flex items-center gap-2">
                          {formatPersianDate(c.updated_at)}
                          {opening === c.id && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
