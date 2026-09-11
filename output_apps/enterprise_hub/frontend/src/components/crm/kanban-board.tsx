"use client";

import { useState } from "react";
import {
  Building2,
  GripVertical,
  Loader2,
  MessageSquare,
  Phone,
  SquareKanban,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatRial } from "@/lib/format";
import {
  PIPELINE_STAGE_ACCENTS,
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGE_ORDER,
  type Lead,
  type PipelineStageGroup,
} from "@/types/crm";

interface KanbanBoardProps {
  groups: PipelineStageGroup[];
  selectedLeadId?: number | null;
  movingLeadId?: number | null;
  onSelectLead: (lead: Lead) => void;
  onMoveLead: (lead: Lead, stage: PipelineStageGroup["stage"]) => void;
}

/**
 * تابلوی بصری کانبان پایپ‌لاین فروش.
 *
 * هر ستون یک مرحله فروش است و کارت‌ها با کشیدن و رها کردن (Drag & Drop) بومی
 * مرورگر بین ستون‌ها جابه‌جا می‌شوند و وضعیت سرنخ در بک‌اند ثبت می‌گردد.
 */
export function KanbanBoard({
  groups,
  selectedLeadId,
  movingLeadId,
  onSelectLead,
  onMoveLead,
}: KanbanBoardProps) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const byStage = new Map(groups.map((group) => [group.stage, group]));

  function handleDrop(stage: PipelineStageGroup["stage"]) {
    setDragOverStage(null);
    if (draggingId === null) {
      return;
    }
    const lead = groups
      .flatMap((group) => group.leads)
      .find((item) => item.id === draggingId);
    setDraggingId(null);
    if (lead && lead.pipelineStage !== stage) {
      onMoveLead(lead, stage);
    }
  }

  return (
    <Card className="border-0 bg-transparent py-0 ring-0">
      <CardContent className="px-0">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <SquareKanban className="size-4 text-indigo-500" />
          تابلوی کانبان پایپ‌لاین فروش
          <span className="text-xs font-normal text-muted-foreground">
            (کارت‌ها را بین ستون‌ها بکشید)
          </span>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-3">
          {PIPELINE_STAGE_ORDER.map((stage) => {
            const group = byStage.get(stage);
            const leads = group?.leads ?? [];
            const isDropTarget = dragOverStage === stage;
            const accent = PIPELINE_STAGE_ACCENTS[stage];

            return (
              <div
                key={stage}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverStage(stage);
                }}
                onDragLeave={() => {
                  setDragOverStage((current) =>
                    current === stage ? null : current,
                  );
                }}
                onDrop={() => handleDrop(stage)}
                className={`flex w-72 shrink-0 flex-col rounded-xl bg-gradient-to-br ${accent} to-transparent p-0.5 ring-1 transition-shadow ${
                  isDropTarget ? "ring-2 shadow-lg" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm font-semibold">
                    {PIPELINE_STAGE_LABELS[stage]}
                  </span>
                  <span className="rounded-full bg-background/70 px-2 py-0.5 text-[11px] font-medium">
                    {leads.length.toLocaleString("fa-IR")}
                  </span>
                </div>
                <div className="px-3 pb-2 text-[11px] text-muted-foreground">
                  {formatRial(group?.totalValue ?? 0)}
                </div>

                <div className="flex min-h-[120px] flex-1 flex-col gap-2 rounded-lg bg-background/40 p-2">
                  {leads.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/60 py-6 text-center text-[11px] text-muted-foreground">
                      سرنخی در این مرحله نیست
                    </div>
                  ) : (
                    leads.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        draggable
                        onClick={() => onSelectLead(lead)}
                        onDragStart={(event) => {
                          setDraggingId(lead.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "text/plain",
                            String(lead.id),
                          );
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDragOverStage(null);
                        }}
                        className={`group flex w-full cursor-grab flex-col gap-2 rounded-lg border bg-card p-3 text-right shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                          selectedLeadId === lead.id
                            ? "border-indigo-500/60 ring-1 ring-indigo-500/30"
                            : "border-border"
                        } ${draggingId === lead.id ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold leading-tight">
                            {lead.fullName}
                          </span>
                          {movingLeadId === lead.id ? (
                            <Loader2 className="size-3.5 shrink-0 animate-spin text-indigo-500" />
                          ) : (
                            <GripVertical className="size-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
                          )}
                        </div>

                        {lead.company && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Building2 className="size-3" />
                            {lead.company}
                          </span>
                        )}

                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          {formatRial(lead.estimatedValue)}
                        </span>

                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          {lead.phone && (
                            <span
                              className="flex items-center gap-1"
                              dir="ltr"
                            >
                              <Phone className="size-3" />
                              {lead.phone}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <MessageSquare className="size-3" />
                            {lead.contactCount.toLocaleString("fa-IR")} تماس
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
