"use client";

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ChequeDirection } from "@/types/cheques";

import { BouncedReport, DueReport } from "./cheque-reports";
import { ChequeRecon } from "./cheque-recon";
import { ChequesList } from "./cheques-list";
import { DueThisWeekStrip } from "./due-strip";
import { ChequeCalculator } from "./cheque-calculator";

const TABS = [
  { key: "list", label: "فهرست چک‌ها" },
  { key: "due", label: "سررسیدها" },
  { key: "bounced", label: "چک‌های برگشتی" },
  { key: "recon", label: "تطبیق با بانک" },
  { key: "calculator", label: "راس‌گیری و تنزیل" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const DIRECTION_TABS: Array<{ key: ChequeDirection; label: string }> = [
  { key: "received", label: "دریافتی" },
  { key: "issued", label: "پرداختنی" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

export function ChequesView() {
  const [tab, setTab] = useState<TabKey>("list");
  const [direction, setDirection] = useState<ChequeDirection>("received");
  const [formOpen, setFormOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="نوع چک" className="flex flex-wrap gap-2">
          {DIRECTION_TABS.map((d) => (
            <Button key={d.key} role="tab" aria-selected={direction === d.key} size="sm" variant={direction === d.key ? "default" : "outline"} onClick={() => setDirection(d.key)}>
              {d.label}
            </Button>
          ))}
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus aria-hidden="true" />
          ثبت چک
        </Button>
      </div>
      {tab === "list" && <DueThisWeekStrip direction={direction} today={todayIso()} refreshKey={refreshKey} />}
      <div role="tablist" aria-label="بخش‌های چک" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.key} role="tab" aria-selected={tab === t.key} size="sm" variant={tab === t.key ? "default" : "outline"} onClick={() => setTab(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>
      {tab === "list" && <ChequesList direction={direction} formOpen={formOpen} onFormOpenChange={setFormOpen} onChanged={refresh} />}
      {tab === "due" && <DueReport />}
      {tab === "bounced" && <BouncedReport />}
      {tab === "recon" && <ChequeRecon />}
      {tab === "calculator" && <ChequeCalculator direction={direction} />}
    </div>
  );
}
