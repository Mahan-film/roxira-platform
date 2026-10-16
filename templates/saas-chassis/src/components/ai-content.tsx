import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Transparency label required for AI-generated content (EU AI Act Art. 50). */
export function AiDisclosure({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)} data-ai-disclosure>
      <span aria-hidden>✦ </span>
      AI-generated content. It may contain errors; verify important information.{" "}
      <Link href="/legal/ai-disclosure" className="underline">
        Learn more
      </Link>
    </p>
  );
}

/** Wrap EVERY place that renders AI output with this so the label can never be forgotten. */
export function AiContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-md border border-border p-4", className)}>
      <div className="whitespace-pre-wrap">{children}</div>
      <AiDisclosure className="mt-3" />
    </div>
  );
}
