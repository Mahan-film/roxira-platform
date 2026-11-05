"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

import { BouncedReport, DueReport } from "./cheque-reports";
import { ChequeRecon } from "./cheque-recon";
import { ChequesList } from "./cheques-list";

const TABS = [
  { key: "list", label: "فهرست چک‌ها" },
  { key: "due", label: "سررسیدها" },
  { key: "bounced", label: "چک‌های برگشتی" },
  { key: "recon", label: "تطبیق با بانک" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function ChequesView() {
  const [tab, setTab] = useState<TabKey>("list");
  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="بخش‌های چک" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.key} role="tab" aria-selected={tab === t.key} size="sm" variant={tab === t.key ? "default" : "outline"} onClick={() => setTab(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>
      {tab === "list" && <ChequesList />}
      {tab === "due" && <DueReport />}
      {tab === "bounced" && <BouncedReport />}
      {tab === "recon" && <ChequeRecon />}
    </div>
  );
}
