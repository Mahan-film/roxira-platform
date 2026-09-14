"use client";
import React from "react";
import { ChatShell } from "@/components/chat/chat-shell";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans" dir="rtl">
      <GhaziHeader userPhone="09129367796" isVip={true} />
      <ChatShell />
      <EnamadFooter />
    </div>
  );
}
