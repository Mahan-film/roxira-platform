"use client";
import React from "react";
import { ChatShell } from "@/components/chat/chat-shell";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export default function ChatPage() {
  return (
    <div className="dark flex flex-col h-screen bg-background text-foreground font-sans overflow-hidden" dir="rtl">
      <GhaziHeader />
      <main className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        <ChatShell />
      </main>
      <EnamadFooter compact={true} />
    </div>
  );
}
