import type { ReactNode } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Accessible loading wrapper for `/app` route segments (`loading.tsx`).
 * Announces `aria-busy="true"` with an sr-only Persian label and respects
 * `prefers-reduced-motion` via `motion-reduce:[&_*]:animate-none`.
 */
export function AppPageSkeleton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn(
        "flex flex-col gap-6 motion-reduce:[&_*]:animate-none",
        className,
      )}
    >
      <span className="sr-only">در حال بارگذاری</span>
      {children}
    </div>
  );
}

/** Matches `PageHeader` in `src/components/app/app-ui.tsx`. */
export function PageHeaderSkeleton({
  actionCount = 0,
  wideDescription = false,
}: {
  actionCount?: number;
  wideDescription?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Skeleton className="size-6 shrink-0 rounded-md" />
          <Skeleton className="h-7 w-40" />
        </div>
        <Skeleton
          className={cn("h-4", wideDescription ? "w-72 sm:w-96" : "w-56 sm:w-72")}
        />
      </div>
      {actionCount > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: actionCount }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-28 rounded-lg" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Matches the 4-card Bento stat row (`AccountingStats`, `CrmStats`, `HrStatsCards`, `InventoryStats`). */
export function StatCardsSkeleton({
  count = 4,
  withSubtext = false,
  withFooterBanner = false,
}: {
  count?: number;
  withSubtext?: boolean;
  withFooterBanner?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index}>
          <CardContent className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-7 w-24" />
              {withSubtext && <Skeleton className="h-3 w-32" />}
            </div>
            <Skeleton className="size-10 shrink-0 rounded-xl" />
          </CardContent>
        </Card>
      ))}
      {withFooterBanner && (
        <Card className="sm:col-span-2 lg:col-span-4">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="h-5 w-28" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Matches a search + filter toolbar row above a data table. */
export function FilterToolbarSkeleton({
  filterCount = 1,
  trailingActionCount = 0,
}: {
  filterCount?: number;
  trailingActionCount?: number;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <Skeleton className="h-9 w-full rounded-lg sm:max-w-sm" />
        {Array.from({ length: filterCount }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-28 rounded-lg" />
        ))}
      </div>
      {trailingActionCount > 0 && (
        <div className="flex gap-1">
          {Array.from({ length: trailingActionCount }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-20 rounded-lg" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Matches a `Card` (or bordered container) wrapping a `Table` with header and body rows. */
export function TableCardSkeleton({
  columns = 6,
  rows = 5,
  withCardHeader = false,
}: {
  columns?: number;
  rows?: number;
  withCardHeader?: boolean;
}) {
  return (
    <Card>
      {withCardHeader && (
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: columns }).map((_, index) => (
              <TableHead key={index}>
                <Skeleton className="h-4 w-20" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <TableRow key={rowIndex}>
              {Array.from({ length: columns }).map((__, colIndex) => (
                <TableCell key={colIndex}>
                  <Skeleton className="h-4 w-full max-w-32" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
