import type { Metadata } from "next";
import { ChatShell } from "@/components/chat/chat-shell";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

const CHAT_TITLE = "گفتگوی هوشمند حقوقی | قاضی هوشمند";
const CHAT_DESCRIPTION =
  "گفتگوی آنلاین با دستیار تخصصی حقوقی هوشمند؛ تحلیل دعاوی، استخراج ادله اثبات دعوا، انشای لایحه دفاعیه و اعاده دادرسی.";

export const metadata: Metadata = {
  title: CHAT_TITLE,
  description: CHAT_DESCRIPTION,
  alternates: { canonical: "https://ghazihoushmand.ir/chat" },
  openGraph: {
    title: CHAT_TITLE,
    description: CHAT_DESCRIPTION,
    url: "https://ghazihoushmand.ir/chat",
    siteName: "قاضی هوشمند",
    locale: "fa_IR",
    type: "website",
  },
};

export default function ChatPage() {
  return (
    <div className="dark glass-app-bg flex flex-col h-screen text-foreground font-sans overflow-hidden" dir="rtl">
      <GhaziHeader />
      <main className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        <h1 className="px-4 pt-3 pb-1 text-center text-sm font-semibold text-amber-300">
          گفتگوی هوشمند حقوقی
        </h1>
        <ChatShell />
      </main>
      <EnamadFooter compact={true} />
    </div>
  );
}
