"use client";
import React from "react";
import { ChatShell } from "@/components/chat/chat-shell";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export default function ChatPage() {
  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden" dir="rtl">
      <GhaziHeader userPhone="09129367796" isVip={true} />
      <main className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        <ChatShell />
      </main>
      <EnamadFooter compact={true} />
    </div>
  );
}
