"use client";

import { History, Loader2, MessageSquare, Plus, Trash2, X } from "lucide-react";

import type { ChatConversation } from "@/lib/api/smart-judge-client";
import { formatPersianDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ChatSidebarProps {
  conversations: ChatConversation[];
  activeId: string | null;
  open: boolean;
  loading?: boolean;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * سایدبار تاریخچه گفتگوهای قاضی هوشمند.
 *
 * رفتار واکنش‌گرا:
 *   • موبایل: کشویی (Drawer) از سمت راست با پوشش تاریک و قفل اسکرول.
 *   • دسکتاپ (`lg`): ستون ثابت کنار میز کار و همیشه در دسترس.
 */
export function ChatSidebar({
  conversations,
  activeId,
  open,
  loading = false,
  onClose,
  onNew,
  onSelect,
  onDelete,
}: ChatSidebarProps) {
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="بستن تاریخچه گفتگوها"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-72 flex-col border-l border-white/8 bg-[#0A0F1C] transition-transform duration-300 ease-out chat-history",
          open ? "translate-x-0" : "translate-x-full",
          "lg:static lg:z-auto lg:translate-x-0",
        )}
      >
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <History className="size-4 text-amber-300" />
            تاریخچه گفتگوها
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100 lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-3">
          <button
            type="button"
            onClick={onNew}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-[13px] font-semibold text-amber-200 transition-colors hover:bg-amber-400/20"
          >
            <Plus className="size-4" />
            گفتگوی جدید
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-slate-400">
              <Loader2 className="size-4 animate-spin" />
              در حال بارگذاری...
            </div>
          )}

          {!loading && conversations.length === 0 && (
            <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-slate-500">
              هنوز گفتگویی ثبت نشده است. با «گفتگوی جدید» شروع کنید.
            </p>
          )}

          <ul className="space-y-1">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeId;
              return (
                <li key={conversation.id}>
                  <div
                    className={cn(
                      "group flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors",
                      isActive
                        ? "border-amber-400/30 bg-amber-400/10"
                        : "border-transparent hover:border-white/10 hover:bg-white/[0.03]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(conversation.id)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-right"
                    >
                      <MessageSquare
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          isActive ? "text-amber-300" : "text-slate-500",
                        )}
                      />
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block truncate text-[12.5px] font-medium",
                            isActive ? "text-amber-100" : "text-slate-200",
                          )}
                        >
                          {conversation.title || "گفتگوی بدون عنوان"}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {formatPersianDate(conversation.updated_at ?? conversation.created_at ?? "")}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(conversation.id);
                      }}
                      aria-label="حذف گفتگو"
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-500 opacity-0 transition-all hover:bg-rose-500/15 hover:text-rose-300 focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </>
  );
}
