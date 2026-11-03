import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: ReactNode;
  description: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Calm empty state for list and table pages across the business suite.
 * Displays an icon from the existing icon set, one clear Persian sentence
 * explaining what the page is for, and the page's existing primary action button.
 */
export function EmptyState({
  icon,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn("border-border/60 bg-card/60", className)}>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground ring-1 ring-border/50">
          {icon}
        </div>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        {action && <div className="mt-2">{action}</div>}
      </CardContent>
    </Card>
  );
}
