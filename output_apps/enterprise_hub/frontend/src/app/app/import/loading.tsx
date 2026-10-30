import {
  AppPageSkeleton,
  PageHeaderSkeleton,
} from "@/components/app/page-skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SuiteImportLoading() {
  return (
    <AppPageSkeleton>
      <PageHeaderSkeleton wideDescription />
      <div className="flex flex-wrap gap-2 rounded-2xl bg-muted/40 p-1">
        <Skeleton className="h-9 w-48 rounded-xl" />
        <Skeleton className="h-9 w-40 rounded-xl" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-7 w-40 rounded-full" />
        <Skeleton className="h-7 w-28 rounded-full" />
      </div>
      <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-border px-6 py-16">
        <Skeleton className="size-12 rounded-xl" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    </AppPageSkeleton>
  );
}
