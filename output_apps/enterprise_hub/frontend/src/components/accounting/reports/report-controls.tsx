"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { ErrorNotice, loadErrorMessage } from "@/components/app/app-ui";
import { Button } from "@/components/ui/button";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import { downloadReport } from "@/lib/api/accounting-reports-client";
import type { FiscalYear, ReportQuery } from "@/types/accounting-reports";

export const FIELD_CLASS =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PeriodControls({
  years,
  query,
  onChange,
}: {
  years: FiscalYear[];
  query: ReportQuery;
  onChange: (next: ReportQuery) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1">
        <Label htmlFor="report-year">سال مالی</Label>
        <select
          id="report-year"
          className={FIELD_CLASS}
          value={query.fiscalYearId ?? ""}
          onChange={(event) =>
            onChange({ ...query, fiscalYearId: event.target.value ? Number(event.target.value) : undefined })
          }
        >
          <option value="">دوره دلخواه</option>
          {years.map((year) => (
            <option key={year.id} value={year.id}>
              {year.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="report-from">از تاریخ</Label>
        <JalaliDateInput
          id="report-from"
          value={query.from ?? ""}
          onChange={(from) => onChange({ ...query, from: from || undefined })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="report-to">تا تاریخ</Label>
        <JalaliDateInput
          id="report-to"
          value={query.to ?? ""}
          onChange={(to) => onChange({ ...query, to: to || undefined })}
        />
      </div>
    </div>
  );
}

export function ExportButtons({
  report,
  query,
  disabled,
}: {
  report: string;
  query: Record<string, string | number | undefined>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(format: "xlsx" | "pdf") {
    setBusy(true);
    setError(null);
    try {
      await downloadReport(report, format, query);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy || disabled} onClick={() => run("xlsx")}>
          <Download aria-hidden="true" />
          Excel
        </Button>
        <Button variant="outline" size="sm" disabled={busy || disabled} onClick={() => run("pdf")}>
          <Download aria-hidden="true" />
          PDF
        </Button>
      </div>
      <ErrorNotice title="خروجی ساخته نشد" message={error} />
    </div>
  );
}
