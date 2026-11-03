import {
  AppPageSkeleton,
  PageHeaderSkeleton,
  TableCardSkeleton,
} from "@/components/app/page-skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SuiteBankReconciliationLoading() {
  return (
    <AppPageSkeleton>
      <PageHeaderSkeleton actionCount={2} />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-56 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-32 rounded-lg" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-8 w-32 rounded-lg" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-7 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="flex justify-between border-b border-border/50 py-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <TableCardSkeleton columns={7} rows={6} withCardHeader />
      <TableCardSkeleton columns={6} rows={5} withCardHeader />
    </AppPageSkeleton>
  );
}
