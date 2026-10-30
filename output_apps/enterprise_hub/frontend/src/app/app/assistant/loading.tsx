import {
  AppPageSkeleton,
  PageHeaderSkeleton,
} from "@/components/app/page-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SuiteAssistantLoading() {
  return (
    <AppPageSkeleton>
      <PageHeaderSkeleton wideDescription />
      <Card className="flex min-h-[60vh] flex-1 flex-col">
        <CardContent className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10">
            <Skeleton className="h-4 w-28" />
            <div className="flex flex-wrap justify-center gap-2">
              <Skeleton className="h-9 w-44 rounded-xl" />
              <Skeleton className="h-9 w-52 rounded-xl" />
              <Skeleton className="h-9 w-48 rounded-xl" />
            </div>
          </div>
          <div className="flex items-end gap-2">
            <Skeleton className="h-14 flex-1 rounded-lg" />
            <Skeleton className="size-9 shrink-0 rounded-lg" />
          </div>
        </CardContent>
      </Card>
    </AppPageSkeleton>
  );
}
