"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Search, UsersRound } from "lucide-react";

import { CrmStats, PipelineBreakdown } from "@/components/crm/crm-stats";
import { KanbanBoard } from "@/components/crm/kanban-board";
import { LeadDetailPanel } from "@/components/crm/lead-detail-panel";
import { LeadForm } from "@/components/crm/lead-form";
import { SiteHeader } from "@/components/layout/site-header";
import { RoxiraFooter } from "@/components/layout/roxira-footer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  getLeadStats,
  getPipeline,
  updateLeadStage,
} from "@/lib/api/crm-client";
import { ApiClientError } from "@/lib/api/http-client";
import type {
  Lead,
  LeadStats,
  PipelineStageGroup,
} from "@/types/crm";

/**
 * داشبورد مدیریت ارتباط با مشتریان (CRM) و پایپ‌لاین سرنخ‌های فروش.
 *
 * شامل کارت‌های تحلیلی درآمد بالقوه، تابلوی کانبان با انتقال وضعیت سرنخ‌ها،
 * فرم ثبت سرنخ و پنل جزئیات (یادداشت و سوابق تماس) — همه متصل به ماژول
 * `enterprise-hub/crm` در لایه NestJS.
 */
export default function CrmPage() {
  const [pipeline, setPipeline] = useState<PipelineStageGroup[]>([]);
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [search, setSearch] = useState("");
  const [movingLeadId, setMovingLeadId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  const loadOverview = useCallback((signal?: AbortSignal) => {
    startTransition(async () => {
      try {
        const [pipelineResult, statsResult] = await Promise.all([
          getPipeline(signal),
          getLeadStats(signal),
        ]);
        setPipeline(pipelineResult);
        setStats(statsResult);
        setErrorMessage(null);
      } catch (error) {
        if (error instanceof ApiClientError) {
          setErrorMessage(error.details.join(" | "));
        } else if (!(error instanceof DOMException)) {
          setErrorMessage(
            "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
          );
        }
      }
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview, refreshKey]);

  function handleRefresh() {
    setRefreshKey((key) => key + 1);
  }

  async function handleMoveLead(lead: Lead, stage: Lead["pipelineStage"]) {
    setMovingLeadId(lead.id);
    setErrorMessage(null);
    try {
      const updated = await updateLeadStage(lead.id, stage);
      setSelectedLead((current) =>
        current && current.id === updated.id ? updated : current,
      );
      handleRefresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorMessage(error.details.join(" | "));
      } else {
        setErrorMessage(
          "انتقال سرنخ ناموفق بود. لطفاً دوباره تلاش کنید.",
        );
      }
    } finally {
      setMovingLeadId(null);
    }
  }

  const filteredPipeline = useMemo<PipelineStageGroup[]>(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return pipeline;
    }
    return pipeline.map((group) => {
      const leads = group.leads.filter((lead) => {
        return (
          lead.fullName.toLowerCase().includes(term) ||
          lead.email.toLowerCase().includes(term) ||
          (lead.company ?? "").toLowerCase().includes(term) ||
          (lead.phone ?? "").toLowerCase().includes(term)
        );
      });
      return {
        ...group,
        leads,
        count: leads.length,
        totalValue: leads.reduce((sum, lead) => sum + lead.estimatedValue, 0),
      };
    });
  }, [pipeline, search]);

  return (
    <div className="dark flex min-h-full flex-1 flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <UsersRound className="size-6 text-indigo-500" />
            مدیریت ارتباط با مشتریان و پایپ‌لاین فروش
          </h1>
          <p className="text-sm text-muted-foreground">
            ثبت و پیگیری سرنخ‌ها، مدیریت سوابق تماس و تحلیل ریالی فرصت‌های باز
            — متصل به{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              /enterprise-hub/crm
            </code>
          </p>
        </div>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>خطا در دریافت اطلاعات CRM</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <CrmStats stats={stats} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LeadForm onCreated={handleRefresh} />
          </div>
          <PipelineBreakdown stats={stats} />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جست‌وجو در نام، رایانامه، شرکت یا تلفن سرنخ"
              className="pr-8"
            />
          </div>
          {isPending && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              در حال به‌روزرسانی...
            </span>
          )}
        </div>

        <KanbanBoard
          groups={filteredPipeline}
          selectedLeadId={selectedLead?.id ?? null}
          movingLeadId={movingLeadId}
          onSelectLead={setSelectedLead}
          onMoveLead={handleMoveLead}
        />

        {selectedLead && (
          <LeadDetailPanel
            lead={selectedLead}
            onUpdated={(updated) => {
              setSelectedLead(updated);
              handleRefresh();
            }}
            onContactAdded={handleRefresh}
            onClose={() => setSelectedLead(null)}
          />
        )}
      </main>
      <RoxiraFooter />
    </div>
  );
}
