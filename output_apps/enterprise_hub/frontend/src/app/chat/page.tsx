import type { Metadata } from "next";
import { ChatShell } from "@/components/chat/chat-shell";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export const metadata: Metadata = {
  title: "قاضی هوشمند | دستیار حقوقی هوشمند و انشای لوایح",
  description:
    "دستیار حقوقی هوشمند برای تحلیل دادخواست، تنظیم لایحه اعاده دادرسی و محاسبه خسارت تاخیر تادیه.",
};

export default function ChatPage() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans" dir="rtl">
      <header className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80 sticky top-0 z-20 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-lg">
            ⚖️
          </div>
          <div>
            <h1 className="font-bold text-base text-amber-400">قاضی هوشمند</h1>
            <p className="text-[11px] text-slate-400">دستیار حقوقی هوشمند و انشای لوایح</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs rounded-full flex items-center gap-1.5 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            09129367796 (VIP)
          </span>
          <a
            href="/admin"
            className="text-xs text-slate-400 hover:text-white px-2 py-1 bg-slate-900 rounded-lg border border-slate-800 transition-colors"
          >
            ادمین
          </a>
        </div>
      </header>

      <ChatShell />
      <EnamadFooter />
    </div>
  );
}
