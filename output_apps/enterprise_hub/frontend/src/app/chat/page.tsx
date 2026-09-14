import type { Metadata } from "next";
import { ChatShell } from "@/components/chat/chat-shell";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export const metadata: Metadata = {
  title: "قاضی هوشمند | دستیار حقوقی هوشمند و انشای لوایح",
  description:
    "دستیار حقوقی هوشمند برای تحلیل دادخواست، تنظیم لایحه اعاده دادرسی و استعلام آرای وحدت رویه دیوان عالی کشور.",
};

export default function ChatPage() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans" dir="rtl">
      <GhaziHeader userPhone="09129367796" isVip={true} />
      <ChatShell />
      <EnamadFooter />
    </div>
  );
}
