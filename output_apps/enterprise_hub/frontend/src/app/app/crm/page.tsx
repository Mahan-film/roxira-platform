"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Contact, KanbanSquare, Plus, Search, Table2 } from "lucide-react";

import {
  EmptyImportState,
  ErrorNotice,
  LoadingLine,
  PageHeader,
  loadErrorMessage,
} from "@/components/app/app-ui";
import { CrmStats } from "@/components/crm/crm-stats";
import { KanbanBoard } from "@/components/crm/kanban-board";
import { LeadDetailPanel } from "@/components/crm/lead-detail-panel";
import { LeadForm } from "@/components/crm/lead-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getLead,
  getLeadStats,
  getPipeline,
  listLeads,
  updateLeadStage,
} from "@/lib/api/crm-client";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import {
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGE_ORDER,
  type Lead,
  type LeadStats,
  type PipelineStage,
  type PipelineStageGroup,
} from "@/types/crm";

const PAGE_SIZE = 25;

/** «Move to next stage» for an open lead; nothing for won or lost ones. */
function nextStageActions(lead: Lead, move: (lead: Lead, stage: PipelineStage) => void) {
  const index = PIPELINE_STAGE_ORDER.indexOf(lead.pipelineStage);
  const next = PIPELINE_STAGE_ORDER[index + 1];
  if (!next || lead.pipelineStage === "WON" || lead.pipelineStage === "LOST") return [];
  return [{ label: `انتقال به «${PIPELINE_STAGE_LABELS[next]}»`, onSelect: () => move(lead, next) }];
}

type View = "table" | "board";

export default function SuiteCrmPage() {
  return (
    <Suspense fallback={null}>
      <CrmPage />
    </Suspense>
  );
}

function CrmPage() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>(searchParams.get("view") === "board" ? "board" : "table");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<PipelineStage | "">(() => {
    const raw = searchParams.get("stage");
    return raw && (PIPELINE_STAGE_ORDER as string[]).includes(raw) ? (raw as PipelineStage) : "";
  });
  const [page, setPage] = useState(1);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [pipeline, setPipeline] = useState<PipelineStageGroup[]>([]);
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const [movingId, setMovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // `?lead=<id>` (e.g. the party link on an invoice) opens that record's panel.
  const leadParam = searchParams.get("lead");
  useEffect(() => {
    const id = Number(leadParam);
    if (!leadParam || !Number.isInteger(id) || id <= 0) return;
    const controller = new AbortController();
    getLead(id, controller.signal)
      .then(setSelected)
      .catch(() => {
        // Missing or another tenant's record: stay on the list.
      });
    return () => controller.abort();
  }, [leadParam]);

  // Debounce the search box so we do not call the API on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listLeads(
        { page, limit: PAGE_SIZE, stage: stage || undefined, search: search || undefined },
        controller.signal,
      ),
      getPipeline(controller.signal),
      getLeadStats(controller.signal),
    ])
      .then(([list, pipelineResult, statsResult]) => {
        setLeads(list.data);
        setTotal(list.total);
        setPipeline(pipelineResult);
        setStats(statsResult);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, stage, search, refreshKey]);

  async function handleMove(lead: Lead, target: PipelineStage) {
    setMovingId(lead.id);
    setError(null);
    try {
      const updated = await updateLeadStage(lead.id, target);
      setSelected((cur) => (cur && cur.id === updated.id ? updated : cur));
      refresh();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setMovingId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isEmpty = !loading && !error && total === 0 && !search && !stage;

  return (
    <>
      <PageHeader
        title="مشتریان (CRM)"
        description="سرنخ‌ها، مراحل فروش و یادداشت‌ها"
        icon={<Contact className="size-6 text-indigo-500" />}
        actions={
          <Button onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>
            <Plus />
            مشتری جدید
          </Button>
        }
      />

      <ErrorNotice title="خطا در دریافت اطلاعات CRM" message={error} />

      <CrmStats stats={stats} />

      {showForm && (
        <LeadForm
          onCreated={() => {
            setShowForm(false);
            refresh();
          }}
        />
      )}

      {isEmpty ? (
        <EmptyImportState
          title="فایل اکسل مشتریان قبلی‌تان را اینجا رها کنید"
          hint="برای ورود خودکار مشتریان، به صفحه ورود داده بروید"
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1 sm:max-w-sm">
                <Search className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="جست‌وجو در نام، ایمیل، شرکت یا تلفن"
                  className="ps-8"
                  aria-label="جست‌وجوی مشتریان"
                />
              </div>
              <select
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value as PipelineStage | "");
                  setPage(1);
                }}
                aria-label="فیلتر مرحله"
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              >
                <option value="">همه مراحل</option>
                {PIPELINE_STAGE_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {PIPELINE_STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
              <LoadingLine show={loading} />
            </div>
            <div className="flex gap-1">
              <Button
                variant={view === "table" ? "default" : "outline"}
                size="sm"
                onClick={() => setView("table")}
              >
                <Table2 />
                جدول
              </Button>
              <Button
                variant={view === "board" ? "default" : "outline"}
                size="sm"
                onClick={() => setView("board")}
              >
                <KanbanSquare />
                پایپ‌لاین
              </Button>
            </div>
          </div>

          {view === "table" ? (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>شرکت</TableHead>
                    <TableHead>شخص تماس</TableHead>
                    <TableHead>تلفن</TableHead>
                    <TableHead>مرحله</TableHead>
                    <TableHead>ارزش</TableHead>
                    <TableHead>تاریخ ثبت</TableHead>
                    <TableHead>
                      <span className="sr-only">عملیات</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        {loading ? "در حال بارگذاری..." : "موردی یافت نشد."}
                      </TableCell>
                    </TableRow>
                  )}
                  {leads.map((lead) => (
                    <TableRow
                      key={lead.id}
                      data-state={selected?.id === lead.id ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => setSelected(lead)}
                    >
                      <TableCell className="font-medium">{lead.company ?? "—"}</TableCell>
                      <TableCell>{lead.fullName}</TableCell>
                      <TableCell dir="ltr" className="text-end font-mono text-xs">
                        {lead.phone ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {PIPELINE_STAGE_LABELS[lead.pipelineStage]}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatMoneyRial(lead.estimatedValue)}</TableCell>
                      <TableCell>{formatJalaliDate(lead.createdAt)}</TableCell>
                      <TableCell>
                        <RowActionsMenu
                          label={`عملیات ${lead.fullName}`}
                          actions={[
                            { label: "مشاهده و ویرایش", onSelect: () => setSelected(lead) },
                            ...nextStageActions(lead, handleMove),
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between gap-2 border-t border-border p-3 text-xs text-muted-foreground">
                  <span>
                    {formatNumber(total)} مورد — صفحه {formatNumber(page)} از{" "}
                    {formatNumber(pageCount)}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      قبلی
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pageCount}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      بعدی
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ) : (
            <KanbanBoard
              groups={pipeline}
              selectedLeadId={selected?.id ?? null}
              movingLeadId={movingId}
              onSelectLead={setSelected}
              onMoveLead={handleMove}
            />
          )}
        </>
      )}

      {selected && (
        <LeadDetailPanel
          lead={selected}
          onUpdated={(updated) => {
            setSelected(updated);
            refresh();
          }}
          onContactAdded={refresh}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
