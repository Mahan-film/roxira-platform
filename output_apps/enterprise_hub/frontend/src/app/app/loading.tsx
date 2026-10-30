import {
  AppPageSkeleton,
  PageHeaderSkeleton,
} from "@/components/app/page-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const DASHBOARD_SECTIONS = 4;
const SECTION_CARDS = 4;

export default function SuiteDashboardLoading() {
  return (
    <AppPageSkeleton>
      <PageHeaderSkeleton />
      {Array.from({ length: DASHBOARD_SECTIONS }).map((_, sectionIndex) => (
        <section key={sectionIndex} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-32" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: SECTION_CARDS }).map((__, cardIndex) => (
              <Card key={cardIndex} className="h-full border-0 ring-1 ring-border">
                <CardContent className="flex flex-col gap-2 py-4">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-6 w-28" />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </AppPageSkeleton>
  );
}
