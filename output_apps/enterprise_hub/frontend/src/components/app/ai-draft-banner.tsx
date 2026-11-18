"use client";

import { Bot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AiSourceCitation } from "@/types/invoice-capture";

/**
 * EU AI Act Art. 50 / T191 transparency badge for any AI-generated draft.
 */
export function AiDraftBadge({ label = "AI-generated draft" }: { label?: string }) {
  return (
    <Badge
      variant="outline"
      data-testid="ai-generated-draft-badge"
      className="inline-flex items-center gap-1.5 border-border bg-muted text-foreground"
    >
      <Bot className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </Badge>
  );
}

/**
 * Renders the source citations that support an AI-generated draft.
 */
export function AiSourceCitations({
  citations,
}: {
  citations: readonly AiSourceCitation[];
}) {
  if (citations.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="ai-source-citations">
        منابع استناد: بدون ارجاع خارجی
      </p>
    );
  }
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
      data-testid="ai-source-citations"
    >
      <span className="font-medium text-foreground/80">منابع استناد:</span>
      {citations.map((citation, index) => (
        <span
          key={`${citation.kind}-${citation.label}-${index}`}
          className="rounded-md border border-border bg-muted/40 px-2 py-0.5"
        >
          {citation.reference ? (
            <a
              href={citation.reference}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              {citation.label}
            </a>
          ) : (
            citation.label
          )}
        </span>
      ))}
    </div>
  );
}
