import { Suspense } from "react";
import type { Metadata } from "next";
import { ChatShell } from "@/components/chat/chat-shell";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";
import { ONBOARDING_LINE } from "@/lib/chat-actions";

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
    <div className="dark ap-theme flex flex-col h-dvh overflow-hidden" data-theme="dark" dir="rtl" lang="fa">
      <GhaziHeader />
      <main className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        <div className="mx-auto w-full max-w-[var(--ap-content-max)] px-4 pt-2 pb-0 text-center sm:px-6 sm:pt-4 sm:pb-1">
          <h1 className="text-base font-semibold tracking-tight sm:text-2xl">گفتگوی هوشمند حقوقی</h1>
          <p className="ap-notice mx-auto mt-1 hidden max-w-[60ch] sm:block">{ONBOARDING_LINE}</p>
        </div>
        <Suspense fallback={null}>
          <ChatShell />
        </Suspense>
      </main>
      <EnamadFooter compact={true} />
    </div>
  );
}
