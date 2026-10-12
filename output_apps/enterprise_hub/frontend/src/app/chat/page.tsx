import { Suspense } from "react";
import type { Metadata } from "next";
import { ChatShell } from "@/components/chat/chat-shell";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

const CHAT_TITLE = "گفتگوی حقوقی | قاضی هوشمند";
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
    <div className="dark ap-theme flex flex-col h-dvh overflow-hidden" data-theme="dark" dir="rtl" lang="fa">
      <a href="#chat-main" className="ap-skip-link">رفتن به گفتگو</a>
      <GhaziHeader />
      <main id="chat-main" tabIndex={-1} className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        <h1 className="sr-only">گفتگوی حقوقی</h1>
        <Suspense fallback={null}>
          <ChatShell />
        </Suspense>
      </main>
      <EnamadFooter compact={true} />
    </div>
  );
}
