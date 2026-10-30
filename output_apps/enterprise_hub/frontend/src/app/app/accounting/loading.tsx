import {
  AppPageSkeleton,
  PageHeaderSkeleton,
  StatCardsSkeleton,
  TableCardSkeleton,
} from "@/components/app/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function SuiteAccountingLoading() {
  return (
    <AppPageSkeleton>
      <PageHeaderSkeleton actionCount={1} />
      <StatCardsSkeleton />
      <TableCardSkeleton columns={4} rows={5} withCardHeader />
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
        <TableCardSkeleton columns={7} rows={6} />
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-6 w-56" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-48 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>
        <TableCardSkeleton columns={7} rows={5} />
      </div>
    </AppPageSkeleton>
  );
}
