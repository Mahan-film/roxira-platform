"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, FileSpreadsheet, Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api/http-client";

/** Persian message for any thrown value from a read call. */
export function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.details.join(" | ");
  return "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.";
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          {icon}
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}

export function ErrorNotice({
  title,
  message,
}: {
  title: string;
  message: string | null;
}) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function LoadingLine({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      در حال به‌روزرسانی...
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
}) {
  const body = (
    <Card className="h-full border-0 ring-1 ring-border transition-colors hover:ring-indigo-500/40">
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
          {label}
          {href && <ChevronLeft className="size-3.5" aria-hidden="true" />}
        </span>
        <span className="text-xl font-bold">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-indigo-500">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Empty state that points the user to the AI import wizard. */
export function EmptyImportState({
  title,
  hint,
}: {
  title: string;
  hint: string;
}) {
  return (
    <Link
      href="/app/import"
      className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-indigo-500/40 bg-indigo-500/5 px-6 py-10 text-center transition-colors hover:bg-indigo-500/10"
    >
      <FileSpreadsheet className="size-8 text-indigo-400" aria-hidden="true" />
      <span className="text-sm font-bold">{title}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </Link>
  );
}
