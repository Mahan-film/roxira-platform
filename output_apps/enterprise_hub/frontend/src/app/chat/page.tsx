import type { Metadata } from "next";

import { ChatShell } from "@/components/chat/chat-shell";

export const metadata: Metadata = {
  title: "قاضی هوشمند | دستیار حقوقی هوشمند",
  description:
    "دستیار حقوقی هوشمند برای تحلیل دادخواست، تنظیم لایحه اعاده دادرسی و محاسبه خسارت تاخیر تادیه.",
};

export default function ChatPage() {
  return <ChatShell />;
}
